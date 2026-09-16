#!/usr/bin/env python3
"""Compare the March 2025 benchmark across starting point modes.

Joins the per-trial results produced by ``benchmark_march_2025.py`` for two
starting point modes and reports what the mode change does to prediction error,
both overall and for multi-drug versus non-multi-drug cases.

Usage:
    python notebooks/compare_benchmark_modes.py
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

import pandas as pd

NOTEBOOK_DIR = Path(__file__).resolve().parent
if str(NOTEBOOK_DIR) not in sys.path:
	sys.path.insert(0, str(NOTEBOOK_DIR))

from benchmark_march_2025 import (  # noqa: E402
	STARTING_POINT_COLUMNS,
	summarize,
)

DEFAULT_WEIGHTED = NOTEBOOK_DIR / "march_2025_benchmark_predictions_notional_weighted.csv"
DEFAULT_FLOOR = NOTEBOOK_DIR / "march_2025_benchmark_predictions_multi_drug_floor.csv"

JOIN_KEYS = ["neutral_citation", "trial_index"]

SUMMARY_METRICS = [
	"trials",
	"mean_actual_months",
	"mean_predicted_months",
	"mean_difference_months",
	"median_difference_months",
	"mean_absolute_difference_months",
	"median_absolute_difference_months",
	"mean_case_accuracy_percent",
	"within_6_months_percent",
	"within_12_months_percent",
	"within_24_months_percent",
]


def load(path: Path) -> pd.DataFrame:
	frame = pd.read_csv(path)
	if "starting_point_mode" in frame.columns and len(frame):
		print(f"  {path.name}: {len(frame)} rows, mode={frame['starting_point_mode'].iloc[0]}")
	return frame


def build_mode_summary(
	weighted: pd.DataFrame, floor: pd.DataFrame
) -> list[dict[str, Any]]:
	rows: list[dict[str, Any]] = []
	for mode, frame in (
		("notional-weighted", weighted),
		("multi-drug-floor", floor),
	):
		predicted = frame.loc[frame["predicted_final_months"].notna()]
		for group_label, group in (
			("multi-drug", predicted.loc[predicted["multi_drug"]]),
			("non-multi-drug", predicted.loc[~predicted["multi_drug"]]),
			("all", predicted),
		):
			summary = summarize(group)
			if summary:
				rows.append(
					{"starting_point_mode": mode, "group": group_label, **summary}
				)
	return rows


def build_comparison(mode_summary: pd.DataFrame) -> pd.DataFrame:
	if mode_summary.empty:
		return mode_summary
	metrics = SUMMARY_METRICS
	weighted = mode_summary.loc[
		mode_summary["starting_point_mode"] == "notional-weighted"
	].set_index("group")
	floor = mode_summary.loc[
		mode_summary["starting_point_mode"] == "multi-drug-floor"
	].set_index("group")

	rows: list[dict[str, Any]] = []
	for group in ("multi-drug", "non-multi-drug", "all"):
		if group not in weighted.index or group not in floor.index:
			continue
		for metric in metrics:
			before = weighted.loc[group, metric]
			after = floor.loc[group, metric]
			rows.append(
				{
					"group": group,
					"metric": metric,
					"notional_weighted": before,
					"multi_drug_floor": after,
					"delta": round(float(after) - float(before), 2),
				}
			)
	return pd.DataFrame(rows)


def build_stage_summary(
	weighted: pd.DataFrame, floor: pd.DataFrame
) -> pd.DataFrame:
	"""Starting-point accuracy by mode, over the same groups as the summary.

	Requires the ``--starting-point`` columns added by benchmark_march_2025.py;
	older CSVs yield an empty frame and the caller skips the section.
	"""
	required = set(STARTING_POINT_COLUMNS.values()) | {"multi_drug"}
	rows: list[dict[str, Any]] = []
	for mode, frame in (
		("notional-weighted", weighted),
		("multi-drug-floor", floor),
	):
		if not required <= set(frame.columns):
			continue
		scored = frame.loc[frame[STARTING_POINT_COLUMNS["difference_column"]].notna()]
		for group_label, group in (
			("multi-drug", scored.loc[scored["multi_drug"]]),
			("non-multi-drug", scored.loc[~scored["multi_drug"]]),
			("all", scored),
		):
			summary = summarize(group, **STARTING_POINT_COLUMNS)
			if summary:
				rows.append(
					{"starting_point_mode": mode, "group": group_label, **summary}
				)
	return pd.DataFrame(rows)


def build_joined(weighted: pd.DataFrame, floor: pd.DataFrame) -> pd.DataFrame:
	joined = weighted.merge(floor, on=JOIN_KEYS, suffixes=("_weighted", "_floor"))
	joined["starting_point_delta_months"] = (
		joined["predicted_starting_point_months_floor"]
		- joined["predicted_starting_point_months_weighted"]
	)
	joined["final_sentence_delta_months"] = (
		joined["predicted_final_months_floor"]
		- joined["predicted_final_months_weighted"]
	)
	joined["absolute_error_delta_months"] = (
		joined["absolute_difference_months_floor"]
		- joined["absolute_difference_months_weighted"]
	)
	joined["mode_changed_prediction"] = (
		joined["starting_point_delta_months"].abs() > 1e-9
	)
	joined["floor_bound"] = (
		joined["starting_point_uplift_months_floor"].fillna(0) == 0
	)
	if {
		"starting_point_absolute_difference_months_weighted",
		"starting_point_absolute_difference_months_floor",
	} <= set(joined.columns):
		joined["starting_point_absolute_error_delta_months"] = (
			joined["starting_point_absolute_difference_months_floor"]
			- joined["starting_point_absolute_difference_months_weighted"]
		)
	return joined


def build_floor_diagnostics(joined: pd.DataFrame) -> list[dict[str, Any]]:
	floor_mode = joined.loc[joined["predicted_final_months_floor"].notna()]
	multi = floor_mode.loc[floor_mode["multi_drug_weighted"]]
	multi_group = multi.loc[multi["starting_point_group_count_floor"] > 1]
	changed = joined.loc[joined["mode_changed_prediction"]]
	multi_changed = changed.loc[changed["multi_drug_weighted"]]

	def improved(
		group: pd.DataFrame, column: str = "absolute_difference_months"
	) -> int:
		return int(
			(
				group[f"{column}_floor"]
				< group[f"{column}_weighted"]
			).sum()
		)

	def worsened(
		group: pd.DataFrame, column: str = "absolute_difference_months"
	) -> int:
		return int(
			(
				group[f"{column}_floor"]
				> group[f"{column}_weighted"]
			).sum()
		)

	diagnostics = [
		{"item": "trials compared", "value": len(floor_mode)},
		{"item": "multi-drug trials", "value": len(multi)},
		{
			"item": "multi-drug trials spanning more than one guideline group",
			"value": len(multi_group),
		},
		{
			"item": "multi-drug trials where the baseline was the binding sentence",
			"value": int((multi_group["starting_point_uplift_months_floor"] == 0).sum()),
		},
		{
			"item": "trials whose starting point the floor raised",
			"value": len(changed),
		},
		{
			"item": "largest starting point uplift (months)",
			"value": round(float(joined["starting_point_delta_months"].max()), 2),
		},
		{
			"item": "multi-drug trials with a smaller absolute error",
			"value": improved(joined.loc[joined["multi_drug_weighted"]]),
		},
		{
			"item": "multi-drug trials with a larger absolute error",
			"value": worsened(joined.loc[joined["multi_drug_weighted"]]),
		},
		{
			"item": "multi-drug trials unchanged",
			"value": int(
				len(joined.loc[joined["multi_drug_weighted"]])
				- improved(joined.loc[joined["multi_drug_weighted"]])
				- worsened(joined.loc[joined["multi_drug_weighted"]])
			),
		},
		{
			"item": "changed trials with a smaller absolute error",
			"value": improved(multi_changed),
		},
		{
			"item": "changed trials with a larger absolute error",
			"value": worsened(multi_changed),
		},
	]

	starting_point_column = "starting_point_absolute_difference_months"
	if {
		f"{starting_point_column}_weighted",
		f"{starting_point_column}_floor",
	} <= set(joined.columns):
		scored = joined.loc[
			joined["multi_drug_weighted"]
			& joined[f"{starting_point_column}_weighted"].notna()
			& joined[f"{starting_point_column}_floor"].notna()
		]
		diagnostics.extend(
			[
				{
					"item": "multi-drug trials scored against a verified starting point",
					"value": len(scored),
				},
				{
					"item": "multi-drug trials with a smaller starting point error",
					"value": improved(scored, starting_point_column),
				},
				{
					"item": "multi-drug trials with a larger starting point error",
					"value": worsened(scored, starting_point_column),
				},
			]
		)
	return diagnostics


def build_changed_trials(joined: pd.DataFrame) -> pd.DataFrame:
	changed = joined.loc[joined["mode_changed_prediction"]].copy()
	columns = [
		"neutral_citation",
		"trial_index",
		"verified_drug_types_weighted",
		"actual_final_months_weighted",
		"predicted_starting_point_months_weighted",
		"starting_point_baseline_months_floor",
		"predicted_starting_point_months_floor",
		"starting_point_delta_months",
		"predicted_final_months_weighted",
		"predicted_final_months_floor",
		"absolute_difference_months_weighted",
		"absolute_difference_months_floor",
		"absolute_error_delta_months",
	]
	for optional in (
		"actual_starting_point_months_weighted",
		"starting_point_absolute_difference_months_weighted",
		"starting_point_absolute_difference_months_floor",
		"starting_point_absolute_error_delta_months",
	):
		if optional in changed.columns:
			columns.append(optional)
	return (
		changed[columns]
		.sort_values("starting_point_delta_months", ascending=False)
		.reset_index(drop=True)
	)


def main() -> None:
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--weighted-csv", default=str(DEFAULT_WEIGHTED))
	parser.add_argument("--floor-csv", default=str(DEFAULT_FLOOR))
	parser.add_argument(
		"--xlsx",
		default=str(NOTEBOOK_DIR / "march_2025_benchmark_mode_comparison.xlsx"),
	)
	args = parser.parse_args()

	print("loading benchmark results:")
	weighted = load(Path(args.weighted_csv))
	floor = load(Path(args.floor_csv))

	mode_summary = pd.DataFrame(build_mode_summary(weighted, floor))
	comparison = build_comparison(mode_summary)
	stage_summary = build_stage_summary(weighted, floor)
	stage_comparison = build_comparison(stage_summary)
	joined = build_joined(weighted, floor)
	diagnostics = pd.DataFrame(build_floor_diagnostics(joined))
	changed = build_changed_trials(joined)

	print()
	print("=== multi-drug vs non-multi-drug, by mode ===")
	print(
		mode_summary[
			[
				"starting_point_mode",
				"group",
				"trials",
				"mean_actual_months",
				"mean_predicted_months",
				"mean_difference_months",
				"mean_absolute_difference_months",
				"median_absolute_difference_months",
				"mean_case_accuracy_percent",
			]
		].to_string(index=False)
	)

	print()
	print("=== mode comparison (multi-drug-floor minus notional-weighted) ===")
	print(comparison.to_string(index=False))

	print()
	if stage_summary.empty:
		print("=== starting point stage ===")
		print(
			"  the mode CSVs carry no starting-point columns; "
			"re-run benchmark_march_2025.py to score this stage"
		)
	else:
		print("=== predicted vs verified starting point, by mode ===")
		print(
			stage_summary[
				[
					"starting_point_mode",
					"group",
					"trials",
					"mean_actual_months",
					"mean_predicted_months",
					"mean_difference_months",
					"mean_absolute_difference_months",
					"median_absolute_difference_months",
					"mean_case_accuracy_percent",
				]
			].to_string(index=False)
		)
		print()
		print("=== starting point mode comparison (floor minus weighted) ===")
		print(stage_comparison.to_string(index=False))

	print()
	print("=== floor diagnostics ===")
	print(diagnostics.to_string(index=False))

	print()
	print("=== trials where the floor changed the prediction ===")
	print(
		changed[
			[
				"neutral_citation",
				"trial_index",
				"verified_drug_types_weighted",
				"actual_final_months_weighted",
				"predicted_starting_point_months_weighted",
				"predicted_starting_point_months_floor",
				"starting_point_delta_months",
				"absolute_difference_months_weighted",
				"absolute_difference_months_floor",
			]
		].to_string(index=False)
	)

	if args.xlsx:
		with pd.ExcelWriter(args.xlsx, engine="openpyxl") as writer:
			mode_summary.to_excel(writer, sheet_name="summary by mode", index=False)
			comparison.to_excel(writer, sheet_name="mode comparison", index=False)
			diagnostics.to_excel(writer, sheet_name="floor diagnostics", index=False)
			changed.to_excel(writer, sheet_name="changed trials", index=False)
			joined.to_excel(writer, sheet_name="per trial", index=False)
			sheets = [
				("summary by mode", mode_summary),
				("mode comparison", comparison),
				("floor diagnostics", diagnostics),
				("changed trials", changed),
			]
			if not stage_summary.empty:
				stage_summary.to_excel(
					writer, sheet_name="starting point by mode", index=False
				)
				stage_comparison.to_excel(
					writer, sheet_name="starting point comparison", index=False
				)
				sheets.extend(
					[
						("starting point by mode", stage_summary),
						("starting point comparison", stage_comparison),
					]
				)
			for sheet_name, frame in sheets:
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
		print()
		print(f"Wrote comparison workbook to {args.xlsx}")


if __name__ == "__main__":
	main()
