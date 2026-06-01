from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any

import pandas as pd
from dotenv import load_dotenv
from bson import ObjectId
from pymongo import MongoClient
from tqdm.auto import tqdm

from legacy_model import DkPredictor


ASSISTANCE_FACTOR_TO_INPUT = {
    'Assistance - limited': 1,
    'Assistance - useful': 2,
    'Assistance - testify': 3,
    'Assistance - risk': 4,
}

DRUG_TYPE_TO_INPUT_INDEX = {
    'Cocaine': 7,
    'Heroin': 8,
    'Methamphetamine': 9,
    'Ketamine': 10,
    'Nimetazepam': 11,
    'Ecstasy': 12,
    'THC/CBD': 13,
    'Cannabis': 14,
}

PLEA_EARLY_HIGH_COURT_STAGES = {'Up to committal'}
PLEA_LATE_HIGH_COURT_STAGES = {
    'After committal',
    'After dates fixed',
    'First day',
    'During trial',
    'Other',
}

PLEA_EARLY_DISTRICT_COURT_STAGES = {'Plea day'}
PLEA_LATE_DISTRICT_COURT_STAGES = {
    'After dates fixed',
    'First day',
    'During trial',
    'Other',
}


def infer_plea_flag(guilty_plea: dict[str, Any]) -> int | None:
    court_type = guilty_plea.get('court_type')
    if court_type == 'High Court':
        stage = guilty_plea.get('high_court_stage')
        if stage in PLEA_EARLY_HIGH_COURT_STAGES:
            return 15
        if stage in PLEA_LATE_HIGH_COURT_STAGES:
            return 16
    elif court_type == 'District Court':
        stage = guilty_plea.get('district_court_stage')
        if stage in PLEA_EARLY_DISTRICT_COURT_STAGES:
            return 15
        if stage in PLEA_LATE_DISTRICT_COURT_STAGES:
            return 16

    reduction_percentage = guilty_plea.get('reduction_percentage')
    if reduction_percentage is None:
        return None

    return 15 if float(reduction_percentage) >= 30 else 16


def get_collection():
    repo_root = Path(__file__).resolve().parents[1]
    for env_path in (
        repo_root / 'featureExtraction' / '.env',
        repo_root / 'featureVerification' / '.env.local',
        repo_root / '.env',
    ):
        if env_path.exists():
            load_dotenv(env_path)

    client = MongoClient(os.getenv('DB_MONGODB_URI', ''))
    db = client.get_database(os.getenv('DB_NAME', 'drug-sentencing-predictor'))
    return db.get_collection('verified-features'), db.get_collection('user')


def normalize_user_id(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def to_user_ref(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return value
    if isinstance(value, str) and ObjectId.is_valid(value):
        return ObjectId(value)
    return value


def load_verified_usernames(
    verified_collection,
    user_collection,
    query: dict[str, Any],
) -> dict[str, str]:
    verified_ids = verified_collection.distinct('verified_by', query)
    user_refs = [to_user_ref(value) for value in verified_ids if value is not None]

    if not user_refs:
        return {}

    users = user_collection.find(
        {'_id': {'$in': user_refs}},
        {'username': 1, 'name': 1},
    )

    username_map: dict[str, str] = {}
    for user in users:
        user_id = normalize_user_id(user.get('_id'))
        if not user_id:
            continue
        username_map[user_id] = (
            user.get('username')
            or user.get('name')
            or user_id
        )

    return username_map


def get_total_months(sentence: dict[str, Any] | None) -> int:
    if not sentence:
        return 0

    total_months = sentence.get('total_months')
    if total_months is not None:
        return int(total_months)

    sentence_years = int(sentence.get('sentence_years') or 0)
    sentence_months = int(sentence.get('sentence_months') or 0)
    return sentence_years * 12 + sentence_months


def set_bool_flag(vector: list[float], index: int) -> None:
    vector[index] = 1


def build_model_input(trial: dict[str, Any]) -> list[float]:
    vector = [0.0] * 17

    for factor in trial.get('mitigating_factors') or []:
        factor_name = factor.get('factor')
        if factor_name == 'Self-consumption':
            set_bool_flag(vector, 0)
        elif factor_name in ASSISTANCE_FACTOR_TO_INPUT:
            vector[1] = max(
                vector[1], float(ASSISTANCE_FACTOR_TO_INPUT[factor_name])
            )
        elif factor_name == 'Other':
            set_bool_flag(vector, 2)

    for factor in trial.get('aggravating_factors') or []:
        factor_name = factor.get('factor')
        if factor_name in {'Refugee/Asylum', 'Illegal immigrant'}:
            set_bool_flag(vector, 3)
        elif factor_name == 'On bail':
            set_bool_flag(vector, 4)
        elif factor_name == 'Persistent offender':
            set_bool_flag(vector, 5)
        elif factor_name in {'Import', 'Export'}:
            set_bool_flag(vector, 6)

    for drug in trial.get('drugs') or []:
        drug_type = drug.get('drug_type')
        amount = float(drug.get('quantity') or 0)
        if drug_type in DRUG_TYPE_TO_INPUT_INDEX:
            vector[DRUG_TYPE_TO_INPUT_INDEX[drug_type]] += amount

    guilty_plea = trial.get('guilty_plea') or {}
    if guilty_plea.get('pleaded_guilty'):
        plea_flag = infer_plea_flag(guilty_plea)
        if plea_flag is not None:
            set_bool_flag(vector, plea_flag)

    return vector


def evaluate(
    verified_collection,
    user_collection,
    limit: int | None = None,
) -> pd.DataFrame:
    predictor = DkPredictor()
    rows: list[dict[str, Any]] = []

    query = {
        'is_verified': True,
        'exclude': {'$ne': True},
    }
    projection = {
        'judgement.neutral_citation': 1,
        'filename': 1,
        'trials': 1,
        'verified_by': 1,
    }

    verified_username_map = load_verified_usernames(
        verified_collection,
        user_collection,
        query,
    )

    total_docs = verified_collection.count_documents(query)
    if limit is not None:
        total_docs = min(total_docs, limit)

    docs = verified_collection.find(query, projection)
    if limit is not None:
        docs = docs.limit(limit)

    docs = tqdm(docs, total=total_docs, desc='verified judgements')

    for doc in docs:
        trials_container = doc.get('trials') or {}
        trials = trials_container.get('trials') or []
        doc_label = doc.get('filename') or (doc.get('judgement') or {}).get(
            'neutral_citation',
            'verified judgement',
        )

        for index, trial in enumerate(
            tqdm(trials, desc=doc_label, leave=False, position=1)
        ):
            model_input = build_model_input(trial)
            prediction = predictor.explain(model_input)
            predicted_months = int(prediction['final_sentence'])
            actual_months = get_total_months(trial.get('final_sentence'))
            verified_by = normalize_user_id(doc.get('verified_by'))

            rows.append(
                {
                    'neutral_citation': (doc.get('judgement') or {}).get(
                        'neutral_citation'
                    ),
                    'verified_username': verified_username_map.get(
                        verified_by or '',
                        verified_by or '',
                    ),
                    'trial_index': index,
                    'charge_no': (trial.get('charge_type') or {}).get('charge_no'),
                    'predicted_months': predicted_months,
                    'actual_months': actual_months,
                    'difference_months': predicted_months - actual_months,
                    'absolute_difference_months': abs(predicted_months - actual_months),
                }
            )

    return pd.DataFrame(rows)


def print_summary(df: pd.DataFrame) -> None:
    if df.empty:
        print('No verified trials found.')
        return

    summary = pd.DataFrame(
        [
            {
                'trials': len(df),
                'mean_abs_error_months': round(
                    float(df['absolute_difference_months'].mean()), 2
                ),
                'median_abs_error_months': float(df['absolute_difference_months'].median()),
                'exact_match_rate': round(
                    float((df['difference_months'] == 0).mean() * 100), 2
                ),
            }
        ]
    )
    print(summary.to_string(index=False))
    print()
    print(df.head(20).to_string(index=False))


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            'Compare predictor.explain() final sentence months against verified '
            'final_sentence.total_months'
        )
    )
    parser.add_argument('--limit', type=int, default=None)
    parser.add_argument('--csv', type=str, default="notebooks/verified_sentence_compare.csv")
    args = parser.parse_args()

    verified_collection, user_collection = get_collection()
    df = evaluate(verified_collection, user_collection, limit=args.limit)
    print_summary(df)

    if args.csv:
        df.to_csv(args.csv, index=False)
        print()
        print(f'Wrote {len(df)} rows to {args.csv}')


if __name__ == '__main__':
    main()
