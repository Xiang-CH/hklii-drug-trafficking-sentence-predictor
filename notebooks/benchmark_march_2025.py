#!/usr/bin/env python3
"""Benchmark the predictor backend against verified March 2025 cases.

For every verified, non-excluded trial whose judgment date falls in the
requested window, this script:

1. maps the verified features to a ``POST /api/sentence-predictions`` request
   body using the same mapping as
   ``notebooks/predictionModel/full_model_evaluation.ipynb`` (reviewed role
   workbook for the defendant role, canonical factor maps for everything else);
2. sends the request to the running predictor backend over HTTP;
3. compares ``finalSentenceMonths`` with the verified
   ``final_sentence.total_months``, and ``startingPointMonths`` with the
   verified ``starting_point.total_months`` when that value is present and not
   inferred.

Results are split into multi-drug trials (more than one distinct drug type with
a positive quantity) and non-multi-drug trials, and written to a CSV. The
starting point is scored as its own stage: the ``multi-drug-floor`` mode changes
that stage and nothing else, so a final-sentence comparison alone cannot show
whether the mode moved the starting point towards or away from the verified
figure.

Usage:
    python notebooks/benchmark_march_2025.py \
        --api http://127.0.0.1:8787 \
        --start 2025-03-01 --end 2025-04-01
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import pandas as pd
from dotenv import load_dotenv
from pymongo import MongoClient

REPO_ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK_DIR = REPO_ROOT / "notebooks"
if str(NOTEBOOK_DIR) not in sys.path:
	sys.path.insert(0, str(NOTEBOOK_DIR))

from linear_interpolation_model import (  # noqa: E402
	clean_quantity,
	flatten_documents,
	trial_catalogue_key,
)

DEFAULT_ROLE_WORKBOOK = (
	NOTEBOOK_DIR / "predictionModel" / "Role Sentence Adjustments_updated 2026.07.30.xlsx"
)

# --- Verified feature -> model input mapping ---------------------------------
# Mirrors notebooks/predictionModel/full_model_evaluation.ipynb.

DRUG_VERIFIED_TO_MODEL = {
	"Cocaine": "Cocaine",
	"Heroin": "Heroin",
	"Methamphetamine": "Methamphetamine",
	"Ketamine": "Ketamine",
	"Fluorodeschloroketamine": "Fluorodeschloroketamine",
	"Nimetazepam": "Nimetazepam",
	"Ecstasy": "Ecstasy",
	"Cannabis": "Cannabis/THC",
	"THC/CBD": "Cannabis/THC",
}

AGGRAVATING_MODEL_MAP = {
	"Multiple drugs": "Multiple Drugs",
	"Persistent offender": "Persistent offender",
	"On bail": "On bail",
	"Refugee claimant": "Refugee/Asylum",
	"Use of minors": "Use of minors",
}

MITIGATING_MODEL_FACTORS = {
	"Self-consumption",
	"Assistance - limited",
	"Assistance - useful",
	"Assistance - testify",
	"Assistance - risk",
	"Young offender",
	"Medical conditions",
	"Family illness",
	"Rehabilitation programme",
}

PLEA_STAGE_MODEL_MAP = {
	("High Court", "Up to committal"): "Plead guilty (earliest opportunity)",
	("High Court", "After committal"): "Plead guilty (before trial dates are set)",
	("High Court", "After dates fixed"): "Plead guilty (before trial starts)",
	("High Court", "First day"): "Plead guilty (first day of trial)",
	("High Court", "During trial"): "Plead guilty (during the trial)",
	("District Court", "Plea day"): "Plead guilty (earliest opportunity)",
	("District Court", "After dates fixed"): "Plead guilty (before trial starts)",
	("District Court", "First day"): "Plead guilty (first day of trial)",
	("District Court", "During trial"): "Plead guilty (during the trial)",
}

WORKBOOK_ROLE_MAP = {
	"Actual trafficker": "Actual trafficker",
	"Manager/organiser": "Manager / Organiser",
	"Operator/financial controller": "Operator / Financial Controller",
}


def load_march_documents(start: str, end: str) -> list[dict[str, Any]]:
	"""Load verified, non-excluded verified-features documents in a date window."""
	for env_path in (
		REPO_ROOT / "featureExtraction" / ".env",
		REPO_ROOT / "featureVerification" / ".env.local",
		REPO_ROOT / ".env",
	):
		if env_path.exists():
			load_dotenv(env_path)

	client = MongoClient(os.environ["DB_MONGODB_URI"], serverSelectionTimeoutMS=20000)
	database = client.get_database(os.getenv("DB_NAME", "drug-sentencing-predictor"))
	query = {
		"is_verified": True,
		"exclude": {"$ne": True},
		"judgement.judgment_date_time": {"$gte": start, "$lt": end},
	}
	return list(database.get_collection("verified-features").find(query))


def load_reviewed_roles(workbook_path: Path) -> pd.DataFrame:
	"""Reviewed defendant roles keyed by citation/trial/charge/defendant."""
	workbook = pd.read_excel(workbook_path).copy()
	workbook["role_catalogue_key"] = workbook.apply(
		lambda row: trial_catalogue_key(
			row["neutral_citation"],
			row["trial_index"],
			row["Charge_no"],
			row["Defendant_id"],
		),
		axis=1,
	)
	workbook["workbook_excluded"] = (
		pd.to_numeric(workbook["Exclusion"], errors="coerce").fillna(0).eq(1)
	)
	workbook["model_role"] = (
		workbook["Defendant's Role"].astype(str).str.strip().map(WORKBOOK_ROLE_MAP)
	)
	workbook["model_circumstances"] = (
		workbook["Additional Circumstances"]
		.astype(str)
		.eq("Cross-border trafficking")
		.map(lambda value: ["Cross-border trafficking"] if value else [])
	)
	return (
		workbook.loc[
			~workbook["workbook_excluded"] & workbook["model_role"].notna(),
			["role_catalogue_key", "model_role", "model_circumstances"],
		]
		.drop_duplicates("role_catalogue_key")
	)


def load_reviewed_exclusions(workbook_path: Path) -> dict[tuple[str, int], bool]:
	"""Workbook rows the role reviewers flagged as excluded, by citation/trial.

	The reviewed workbook stores ``Exclusion = 1`` when a charge/defendant pair
	cannot be role-classified mechanically. The DB charge numbers do not always
	agree with the workbook's, so the exclusion flag is matched on the
	citation/trial-index pair only.
	"""
	workbook = pd.read_excel(workbook_path)
	excluded = pd.to_numeric(workbook["Exclusion"], errors="coerce").fillna(0).eq(1)
	return {
		(str(citation).strip(), int(trial_index)): bool(flag)
		for citation, trial_index, flag in zip(
			workbook["neutral_citation"], workbook["trial_index"], excluded
		)
	}


def trial_model_drugs(drugs_json: str) -> tuple[list[dict[str, Any]], list[str]]:
	model_drugs: list[dict[str, Any]] = []
	unsupported: list[str] = []
	for drug in json.loads(drugs_json):
		drug_type = drug.get("drug_type")
		if not drug_type:
			continue
		quantity, invalid = clean_quantity(drug.get("quantity"))
		if invalid or quantity <= 0:
			continue
		if drug_type == "Other":
			other = (drug.get("other_drug_type") or "").strip().lower()
			if "midazolam" in other:
				model_drugs.append({"type": "Midazolam", "quantity": quantity})
			else:
				unsupported.append(f"{drug_type}({other})")
			continue
		model_type = DRUG_VERIFIED_TO_MODEL.get(drug_type)
		if model_type is None:
			unsupported.append(drug_type)
		else:
			model_drugs.append({"type": model_type, "quantity": quantity})
	return model_drugs, unsupported


def verified_drug_types(drugs_json: str) -> list[str]:
	"""Distinct substances recorded in the verified trial, positive quantities.

	``Other`` entries are labelled with their ``other_drug_type`` so a case is
	still counted as multi-drug when one of its substances has no model
	guideline.
	"""
	types: list[str] = []
	for drug in json.loads(drugs_json):
		drug_type = drug.get("drug_type")
		if not drug_type:
			continue
		quantity, invalid = clean_quantity(drug.get("quantity"))
		if invalid or quantity <= 0:
			continue
		label = drug_type
		if drug_type == "Other":
			other = (drug.get("other_drug_type") or "Other").strip()
			label = f"Other({other})"
		if label not in types:
			types.append(label)
	return types


def build_request(
	row: pd.Series, starting_point_mode: str
) -> tuple[dict[str, Any], dict[str, Any]]:
	drugs, unsupported_drugs = trial_model_drugs(row["drugs_json"])
	aggravating = [
		AGGRAVATING_MODEL_MAP[factor]
		for factor in row["canonical_aggravating_factors"]
		if factor in AGGRAVATING_MODEL_MAP
	]
	unsupported_aggravating = [
		factor
		for factor in row["canonical_aggravating_factors"]
		if factor not in AGGRAVATING_MODEL_MAP
		and factor not in {"Role of the defendant", "Cross-border trafficking"}
	]
	mitigating = [
		factor
		for factor in row["canonical_mitigating_factors"]
		if factor in MITIGATING_MODEL_FACTORS
	]
	unsupported_mitigating = [
		factor
		for factor in row["canonical_mitigating_factors"]
		if factor not in MITIGATING_MODEL_FACTORS
	]

	plea = json.loads(row["guilty_plea_json"])
	guilty_plea = None
	plea_status = "not guilty"
	if plea.get("pleaded_guilty"):
		stage = (
			plea.get("high_court_stage")
			or plea.get("district_court_stage")
			or "Unknown"
		)
		guilty_plea = PLEA_STAGE_MODEL_MAP.get((plea.get("court_type"), stage))
		plea_status = "mapped" if guilty_plea is not None else "unmapped stage"

	model_role = row["model_role"] if isinstance(row["model_role"], str) else None
	circumstances = (
		list(row["model_circumstances"])
		if isinstance(row["model_circumstances"], list)
		else []
	)
	# schema.ts rejects additionalCircumstances without a defendantRole.
	if model_role is None:
		circumstances = []

	request = {
		"drugs": drugs,
		"defendantRole": model_role,
		"additionalCircumstances": circumstances,
		"guiltyPlea": guilty_plea,
		"aggravatingFactors": list(dict.fromkeys(aggravating)),
		"mitigatingFactors": list(dict.fromkeys(mitigating)),
		"startingPointMode": starting_point_mode,
	}
	context = {
		"unsupported_drugs": unsupported_drugs,
		"unsupported_aggravating": unsupported_aggravating,
		"unsupported_mitigating": unsupported_mitigating,
		"plea_status": plea_status,
		"model_role_source": "reviewed workbook" if model_role else "none",
	}
	return request, context


def call_predictor(api_base: str, request: dict[str, Any]) -> tuple[int, Any]:
	payload = json.dumps(request).encode("utf-8")
	http_request = urllib.request.Request(
		f"{api_base.rstrip('/')}/api/sentence-predictions",
		data=payload,
		headers={"Content-Type": "application/json"},
		method="POST",
	)
	try:
		with urllib.request.urlopen(http_request, timeout=30) as response:
			return response.status, json.loads(response.read())
	except urllib.error.HTTPError as error:
		body = error.read()
		try:
			return error.code, json.loads(body)
		except json.JSONDecodeError:
			return error.code, {"raw": body.decode("utf-8", "replace")}


def run_benchmark(args: argparse.Namespace) -> pd.DataFrame:
	documents = load_march_documents(args.start, args.end)
	trials, _effects = flatten_documents(documents)
	trials = trials.loc[
		trials["final_sentence_months"].notna() & ~trials["final_sentence_inferred"]
	].copy()

	roles = load_reviewed_roles(Path(args.role_workbook))
	trials = trials.merge(
		roles,
		on="role_catalogue_key",
		how="left",
		validate="many_to_one",
	)
	exclusions = load_reviewed_exclusions(Path(args.role_workbook))
	trials["workbook_excluded"] = [
		exclusions.get((str(citation).strip(), int(index)), False)
		for citation, index in zip(trials["neutral_citation"], trials["trial_index"])
	]

	print(
		f"window {args.start} .. {args.end}: {len(documents)} judgments, "
		f"{len(trials)} eligible trials, "
		f"{int(trials['model_role'].notna().sum())} with a reviewed role"
	)

	rows: list[dict[str, Any]] = []
	for _index, row in trials.iterrows():
		request, context = build_request(row, args.starting_point_mode)
		distinct_drugs = {drug["type"] for drug in request["drugs"]}
		verified_types = verified_drug_types(row["drugs_json"])
		record: dict[str, Any] = {
			"starting_point_mode": args.starting_point_mode,
			"neutral_citation": row["neutral_citation"],
			"trial_index": row["trial_index"],
			"charge_no": row["charge_no"],
			"defendant_id": row["defendant_id"],
			"verified_drug_types": " | ".join(verified_types),
			"verified_drug_count": len(verified_types),
			"multi_drug": len(verified_types) > 1,
			"input_drug_types": " | ".join(sorted(distinct_drugs)),
			"input_drug_count": len(distinct_drugs),
			"multiple_drugs_factor": "Multiple drugs"
			in row["canonical_aggravating_factors"],
			"defendant_role": request["defendantRole"],
			"additional_circumstances": " | ".join(
				request["additionalCircumstances"]
			),
			"guilty_plea": request["guiltyPlea"],
			"aggravating_factors": " | ".join(request["aggravatingFactors"]),
			"mitigating_factors": " | ".join(request["mitigatingFactors"]),
			"actual_final_months": row["final_sentence_months"],
			"actual_starting_point_months": row["starting_point_months"],
			"starting_point_inferred": bool(row["starting_point_inferred"]),
			"workbook_excluded": bool(row["workbook_excluded"]),
			**context,
		}
		record["unsupported_any"] = bool(
			context["unsupported_drugs"]
			or context["unsupported_aggravating"]
			or context["unsupported_mitigating"]
		)

		if not request["drugs"]:
			record.update(
				{
					"api_status": None,
					"api_error": "no supported drug quantity",
					"predicted_final_months": None,
				}
			)
			rows.append(record)
			continue

		status, body = call_predictor(args.api, request)
		if status == 200 and body.get("status") == "supported":
			breakdown = body.get("startingPointBreakdown") or {}
			record.update(
				{
					"api_status": status,
					"api_error": None,
					"predicted_starting_point_months": body["startingPointMonths"],
					"predicted_final_months": body["finalSentenceMonths"],
					"starting_point_baseline_months": breakdown.get("baselineMonths"),
					"starting_point_provisional_months": breakdown.get(
						"provisionalMonths"
					),
					"starting_point_uplift_months": breakdown.get("upliftMonths"),
					"starting_point_group_count": len(breakdown.get("groups") or []),
				}
			)
		else:
			record.update(
				{
					"api_status": status,
					"api_error": body.get("error") or body.get("message"),
					"predicted_final_months": None,
				}
			)
		rows.append(record)

	results = pd.DataFrame(rows)
	results["difference_months"] = (
		results["predicted_final_months"] - results["actual_final_months"]
	)
	results["absolute_difference_months"] = results["difference_months"].abs()

	# Starting-point stage. A verified starting point is only scored when it is
	# present and not inferred, mirroring the final-sentence eligibility filter.
	scored_starting_points = results["actual_starting_point_months"].notna() & ~results[
		"starting_point_inferred"
	]
	results["starting_point_difference_months"] = (
		results["predicted_starting_point_months"]
		- results["actual_starting_point_months"]
	).where(scored_starting_points)
	results["starting_point_absolute_difference_months"] = results[
		"starting_point_difference_months"
	].abs()
	return results


def summarize(
	group: pd.DataFrame,
	actual_column: str = "actual_final_months",
	predicted_column: str = "predicted_final_months",
	difference_column: str = "difference_months",
) -> dict[str, Any]:
	"""Accuracy of one stage over one group of trials.

	The column names default to the final-sentence stage; pass the overrides to
	score another stage, such as the starting point.
	"""
	if group.empty:
		return {}
	actual = group[actual_column]
	predicted = group[predicted_column]
	difference = group[difference_column]
	accuracy = (1 - difference.abs() / actual.where(actual > 0)).clip(lower=0)
	return {
		"trials": len(group),
		"mean_actual_months": round(float(actual.mean()), 2),
		"mean_predicted_months": round(float(predicted.mean()), 2),
		"mean_difference_months": round(float(difference.mean()), 2),
		"median_difference_months": round(float(difference.median()), 2),
		"mean_absolute_difference_months": round(float(difference.abs().mean()), 2),
		"median_absolute_difference_months": round(float(difference.abs().median()), 2),
		"mean_case_accuracy_percent": round(float(accuracy.mean() * 100), 2),
		"exact_match_percent": round(float((difference == 0).mean() * 100), 2),
		"within_6_months_percent": round(float((difference.abs() <= 6).mean() * 100), 2),
		"within_12_months_percent": round(float((difference.abs() <= 12).mean() * 100), 2),
		"within_24_months_percent": round(float((difference.abs() <= 24).mean() * 100), 2),
	}


def report(results: pd.DataFrame) -> None:
	predicted = results.loc[results["predicted_final_months"].notna()].copy()
	print()
	print(f"starting point mode: {predicted['starting_point_mode'].iloc[0]}")
	print(f"trials in window: {len(results)}")
	print(f"trials predicted by the backend: {len(predicted)}")
	print(f"trials without a prediction: {len(results) - len(predicted)}")
	if len(results) - len(predicted):
		reasons = results.loc[
			results["predicted_final_months"].isna(),
			["api_error", "unsupported_drugs"],
		]
		print("  unpredicted reasons:")
		for _index, row in reasons.iterrows():
			print(f"    - {row['api_error']} {row['unsupported_drugs']}")

	print()
	print("=== input coverage (share of predicted trials) ===")
	coverage = [
		(
			"reviewed defendant role supplied",
			int((predicted["defendant_role"].notna()).sum()),
		),
		(
			"guilty-plea stage mapped",
			int((predicted["plea_status"] == "mapped").sum()),
		),
		(
			"pleaded guilty but stage unmapped (no plea reduction applied)",
			int((predicted["plea_status"] == "unmapped stage").sum()),
		),
		(
			"at least one unsupported factor dropped",
			int(predicted["unsupported_any"].sum()),
		),
	]
	for label, count in coverage:
		print(f"  {label}: {count}/{len(predicted)}")

	print()
	print("=== predicted vs actual final sentence, by drug-count group ===")
	summary_rows = build_group_rows(predicted)
	summary_frame = pd.DataFrame(summary_rows).set_index("group").T
	print(summary_frame.to_string())

	scored_starting_points = int(
		results["starting_point_difference_months"].notna().sum()
	)
	inferred_starting_points = int(
		(
			results["actual_starting_point_months"].notna()
			& results["starting_point_inferred"]
		).sum()
	)
	print()
	print("=== predicted vs verified starting point, by drug-count group ===")
	print(
		f"  scored trials: {scored_starting_points}/{len(predicted)} "
		f"({inferred_starting_points} skipped as inferred, "
		f"{int(results['actual_starting_point_months'].isna().sum())} without a value)"
	)
	starting_point_rows = build_starting_point_rows(results)
	if starting_point_rows:
		print(pd.DataFrame(starting_point_rows).set_index("group").T.to_string())
	else:
		print("  no verified starting points in scope")

	print()
	print("=== cross-check: split on model-input drug count ===")
	input_rows = []
	for label, group in (
		("multi-drug (input)", predicted.loc[predicted["input_drug_count"] > 1]),
		("non-multi-drug (input)", predicted.loc[predicted["input_drug_count"] <= 1]),
	):
		summary = summarize(group)
		if summary:
			input_rows.append(
				{
					"group": label,
					"trials": summary["trials"],
					"mean_difference_months": summary["mean_difference_months"],
					"mean_absolute_difference_months": summary[
						"mean_absolute_difference_months"
					],
					"mean_case_accuracy_percent": summary["mean_case_accuracy_percent"],
				}
			)
	print(pd.DataFrame(input_rows).to_string(index=False))

	print()
	print("=== cross-check: 'Multiple drugs' aggravating factor ===")
	factor_rows = []
	for label, group in (
		("Multiple drugs factor", predicted.loc[predicted["multiple_drugs_factor"]]),
		("no Multiple drugs factor", predicted.loc[~predicted["multiple_drugs_factor"]]),
	):
		summary = summarize(group)
		if summary:
			factor_rows.append(
				{
					"group": label,
					"trials": summary["trials"],
					"mean_difference_months": summary["mean_difference_months"],
					"mean_absolute_difference_months": summary[
						"mean_absolute_difference_months"
					],
					"mean_case_accuracy_percent": summary["mean_case_accuracy_percent"],
				}
			)
	print(pd.DataFrame(factor_rows).to_string(index=False))

	print()
	print("=== classification cross-tab (trials) ===")
	cross_tab = pd.crosstab(
		predicted["multi_drug"], predicted["multiple_drugs_factor"]
	)
	cross_tab.index = ["single drug type", "multiple drug types"]
	cross_tab.columns = ["no Multiple drugs factor", "Multiple drugs factor"]
	print(cross_tab.to_string())

	sensitivity = predicted.loc[~predicted["workbook_excluded"]]
	print()
	print(
		"=== sensitivity: excluding role-workbook flagged trials "
		f"({int(predicted['workbook_excluded'].sum())} removed) ==="
	)
	sensitivity_rows = []
	for label, group in (
		("multi-drug", sensitivity.loc[sensitivity["multi_drug"]]),
		("non-multi-drug", sensitivity.loc[~sensitivity["multi_drug"]]),
		("all predicted", sensitivity),
	):
		summary = summarize(group)
		if summary:
			sensitivity_rows.append({"group": label, **summary})
	print(pd.DataFrame(sensitivity_rows).set_index("group").T.to_string())

	print()
	print("=== largest absolute errors ===")
	columns = [
		"neutral_citation",
		"trial_index",
		"verified_drug_count",
		"multi_drug",
		"actual_final_months",
		"predicted_final_months",
		"difference_months",
	]
	print(
		predicted.sort_values("absolute_difference_months", ascending=False)
		.head(10)[columns]
		.to_string(index=False)
	)

	dropped = predicted.loc[
		predicted["input_drug_count"] < predicted["verified_drug_count"]
	]
	if len(dropped):
		print()
		print("=== trials where an unsupported drug was dropped from the request ===")
		print(
			dropped[
				[
					"neutral_citation",
					"trial_index",
					"verified_drug_types",
					"unsupported_drugs",
					"input_drug_types",
				]
			].to_string(index=False)
		)

	print()
	print("=== per-trial detail ===")
	print(
		predicted[
			[
				"neutral_citation",
				"trial_index",
				"verified_drug_count",
				"multi_drug",
				"actual_final_months",
				"predicted_final_months",
				"difference_months",
				"absolute_difference_months",
			]
		].to_string(index=False)
	)


def group_splits(scored: pd.DataFrame) -> list[tuple[str, pd.DataFrame]]:
	"""The multi-drug / non-multi-drug / all split, with and without exclusions."""
	groups: list[tuple[str, pd.DataFrame]] = [
		("multi-drug", scored.loc[scored["multi_drug"]]),
		("non-multi-drug", scored.loc[~scored["multi_drug"]]),
		("all", scored),
	]
	without_excluded = scored.loc[~scored["workbook_excluded"]]
	groups.extend(
		[
			(
				"multi-drug (no workbook exclusions)",
				without_excluded.loc[without_excluded["multi_drug"]],
			),
			(
				"non-multi-drug (no workbook exclusions)",
				without_excluded.loc[~without_excluded["multi_drug"]],
			),
			("all (no workbook exclusions)", without_excluded),
		]
	)
	return groups


def build_group_rows(predicted: pd.DataFrame) -> list[dict[str, Any]]:
	rows: list[dict[str, Any]] = []
	for label, group in group_splits(predicted):
		summary = summarize(group)
		if summary:
			rows.append({"group": label, **summary})
	return rows


# Column overrides that score the starting-point stage instead of the final
# sentence. Shared with compare_benchmark_modes.py.
STARTING_POINT_COLUMNS = {
	"actual_column": "actual_starting_point_months",
	"predicted_column": "predicted_starting_point_months",
	"difference_column": "starting_point_difference_months",
}


def build_starting_point_rows(results: pd.DataFrame) -> list[dict[str, Any]]:
	"""Verified-versus-predicted starting point, grouped like the final sentence.

	Trials whose verified starting point is missing or inferred are dropped
	rather than scored as zero, so the trial count per group can be smaller than
	the final-sentence count.
	"""
	scored = results.loc[results["starting_point_difference_months"].notna()]
	rows: list[dict[str, Any]] = []
	for label, group in group_splits(scored):
		summary = summarize(group, **STARTING_POINT_COLUMNS)
		if summary:
			rows.append({"group": label, **summary})
	return rows


def build_classification_rows(predicted: pd.DataFrame) -> list[dict[str, Any]]:
	"""Compact accuracy rows for alternate ways of labelling a case."""
	labels: list[tuple[str, pd.DataFrame]] = [
		(
			"multiple drug types (verified)",
			predicted.loc[predicted["multi_drug"]],
		),
		(
			"single drug type (verified)",
			predicted.loc[~predicted["multi_drug"]],
		),
		(
			"Multiple drugs aggravating factor",
			predicted.loc[predicted["multiple_drugs_factor"]],
		),
		(
			"no Multiple drugs aggravating factor",
			predicted.loc[~predicted["multiple_drugs_factor"]],
		),
		(
			"multiple drug types (model input)",
			predicted.loc[predicted["input_drug_count"] > 1],
		),
		(
			"single drug type (model input)",
			predicted.loc[predicted["input_drug_count"] <= 1],
		),
	]
	rows: list[dict[str, Any]] = []
	for label, group in labels:
		summary = summarize(group)
		if summary:
			rows.append({"classification": label, **summary})
	return rows


def build_coverage_rows(results: pd.DataFrame) -> list[dict[str, Any]]:
	predicted = results.loc[results["predicted_final_months"].notna()]
	return [
		{"item": "trials in window", "count": len(results), "of": len(results)},
		{
			"item": "trials predicted by the backend",
			"count": len(predicted),
			"of": len(results),
		},
		{
			"item": "trials without a prediction",
			"count": len(results) - len(predicted),
			"of": len(results),
		},
		{
			"item": "reviewed defendant role supplied",
			"count": int(predicted["defendant_role"].notna().sum()),
			"of": len(predicted),
		},
		{
			"item": "guilty-plea stage mapped",
			"count": int((predicted["plea_status"] == "mapped").sum()),
			"of": len(predicted),
		},
		{
			"item": "pleaded guilty but stage unmapped (no plea reduction)",
			"count": int((predicted["plea_status"] == "unmapped stage").sum()),
			"of": len(predicted),
		},
		{
			"item": "at least one unsupported factor dropped",
			"count": int(predicted["unsupported_any"].sum()),
			"of": len(predicted),
		},
		{
			"item": "unsupported drug dropped from the request",
			"count": int(
				(predicted["input_drug_count"] < predicted["verified_drug_count"]).sum()
			),
			"of": len(predicted),
		},
		{
			"item": "role-workbook flagged exclusion",
			"count": int(predicted["workbook_excluded"].sum()),
			"of": len(predicted),
		},
		{
			"item": "verified starting point present and not inferred",
			"count": int(predicted["starting_point_difference_months"].notna().sum()),
			"of": len(predicted),
		},
	]


def write_workbook(
	results: pd.DataFrame, path: Path, metadata: dict[str, Any]
) -> None:
	"""Write per-trial predictions plus grouped summary sheets."""
	predicted = results.loc[results["predicted_final_months"].notna()].copy()

	detail_columns = [
		"starting_point_mode",
		"neutral_citation",
		"trial_index",
		"charge_no",
		"defendant_id",
		"verified_drug_types",
		"verified_drug_count",
		"multi_drug",
		"input_drug_types",
		"input_drug_count",
		"multiple_drugs_factor",
		"actual_starting_point_months",
		"predicted_starting_point_months",
		"starting_point_difference_months",
		"starting_point_absolute_difference_months",
		"actual_final_months",
		"predicted_final_months",
		"difference_months",
		"absolute_difference_months",
		"defendant_role",
		"additional_circumstances",
		"guilty_plea",
		"plea_status",
		"aggravating_factors",
		"mitigating_factors",
		"unsupported_drugs",
		"unsupported_aggravating",
		"unsupported_mitigating",
		"model_role_source",
		"workbook_excluded",
		"api_status",
		"api_error",
	]
	detail = (
		predicted[detail_columns]
		.sort_values("absolute_difference_months", ascending=False)
		.reset_index(drop=True)
	)

	cross_tab = pd.crosstab(predicted["multi_drug"], predicted["multiple_drugs_factor"])
	cross_tab.index = pd.Index(
		["single drug type", "multiple drug types"], name="verified drugs"
	)
	cross_tab.columns = pd.Index(
		["no Multiple drugs factor", "Multiple drugs factor"],
		name="aggravating factor",
	)
	cross_tab = cross_tab.reset_index()

	with pd.ExcelWriter(path, engine="openpyxl") as writer:
		run_frame = pd.DataFrame(
			[
				{"field": key, "value": value}
				for key, value in metadata.items()
			]
		)
		run_frame.to_excel(writer, sheet_name="run", index=False)

		summary_frame = pd.DataFrame(build_group_rows(predicted))
		summary_frame.to_excel(writer, sheet_name="summary", index=False)

		classification_rows = build_classification_rows(predicted)
		classification_frame = pd.DataFrame(classification_rows)
		classification_frame.to_excel(
			writer, sheet_name="by classification", index=False
		)
		pd.DataFrame({"classification": ["cross-tab: verified drugs x aggravating factor"]}).to_excel(
			writer,
			sheet_name="by classification",
			index=False,
			startrow=len(classification_rows) + 2,
		)
		cross_tab.to_excel(
			writer,
			sheet_name="by classification",
			index=False,
			startrow=len(classification_rows) + 3,
		)

		coverage_frame = pd.DataFrame(build_coverage_rows(results))
		coverage_frame.to_excel(writer, sheet_name="coverage", index=False)
		starting_point_frame = pd.DataFrame(build_starting_point_rows(results))
		starting_point_frame.to_excel(
			writer, sheet_name="starting point", index=False
		)
		detail.to_excel(writer, sheet_name="per trial", index=False)
		results.to_excel(writer, sheet_name="all trials", index=False)

		for sheet_name, frame in (
			("run", run_frame),
			("summary", summary_frame),
			("by classification", classification_frame),
			("coverage", coverage_frame),
			("starting point", starting_point_frame),
			("per trial", detail),
			("all trials", results),
		):
			worksheet = writer.sheets[sheet_name]
			worksheet.freeze_panes = "A2"
			for index, column in enumerate(frame.columns, start=1):
				width = max(
					len(str(column)),
					int(frame[column].astype(str).str.len().max() or 0),
				)
				worksheet.column_dimensions[
					worksheet.cell(row=1, column=index).column_letter
				].width = min(max(width + 2, 10), 60)


def main() -> None:
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--api", default="http://127.0.0.1:8787")
	parser.add_argument("--start", default="2025-03-01")
	parser.add_argument("--end", default="2025-04-01")
	parser.add_argument("--role-workbook", default=str(DEFAULT_ROLE_WORKBOOK))
	parser.add_argument(
		"--starting-point-mode",
		choices=["notional-weighted", "multi-drug-floor"],
		default="notional-weighted",
		help="Predictor starting point mode to benchmark.",
	)
	parser.add_argument(
		"--csv",
		default=None,
		help="Defaults to march_2025_benchmark_predictions_<mode>.csv",
	)
	parser.add_argument(
		"--xlsx",
		default=None,
		help="Defaults to march_2025_benchmark_summary_<mode>.xlsx",
	)
	args = parser.parse_args()

	mode_suffix = args.starting_point_mode.replace("-", "_")
	if args.csv is None:
		args.csv = str(
			NOTEBOOK_DIR / f"march_2025_benchmark_predictions_{mode_suffix}.csv"
		)
	if args.xlsx is None:
		args.xlsx = str(
			NOTEBOOK_DIR / f"march_2025_benchmark_summary_{mode_suffix}.xlsx"
		)

	results = run_benchmark(args)
	report(results)

	if args.csv:
		results.to_csv(args.csv, index=False)
		print()
		print(f"Wrote {len(results)} rows to {args.csv}")
	if args.xlsx:
		write_workbook(
			results,
			Path(args.xlsx),
			{
				"generated_at": pd.Timestamp.now().isoformat(timespec="seconds"),
				"predictor_api": args.api,
				"starting_point_mode": args.starting_point_mode,
				"window_start": args.start,
				"window_end": args.end,
				"role_workbook": str(args.role_workbook),
				"judgments": int(results["neutral_citation"].nunique()),
				"eligible_trials": len(results),
				"predicted_trials": int(results["predicted_final_months"].notna().sum()),
				"multi_drug_trials": int(
					results.loc[
						results["predicted_final_months"].notna(), "multi_drug"
					].sum()
				),
				"difference_sign": "predicted_final_months - actual_final_months",
				"starting_point_difference_sign": (
					"predicted_starting_point_months - actual_starting_point_months"
				),
				"verified_starting_points_scored": int(
					results["starting_point_difference_months"].notna().sum()
				),
			},
		)
		print(f"Wrote summary workbook to {args.xlsx}")


if __name__ == "__main__":
	main()
