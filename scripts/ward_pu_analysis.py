#!/usr/bin/env python3
"""
Ward-level polling unit analysis without using polling-unit coordinates.

This script:
- loads a polling unit CSV and a ward shapefile
- normalizes ward/LGA names for a reliable composite-key join
- aggregates ward-level statistics from the polling unit data
- flags polling units that do not match any ward boundary
- exports the final ward GeoDataFrame to a GeoPackage
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

import geopandas as gpd
import pandas as pd


DEFAULTS = {
    "polling_csv": "public/data/Nigeria_polling_units.csv",
    "wards_shp": "public/data/boundaries/adm3.zip",
    "output_gpkg": "public/data/ward_pu_analysis.gpkg",
    "output_layer": "ward_pu_stats",
    "summary_json": "public/data/ward_pu_summary.json",
    "stats_csv": "public/data/ward_pu_stats.csv",
    "unmatched_csv": "public/data/unmatched_pus.csv",
    "pu_code_col": "pu_code",
    "pu_name_col": "pu_name",
    "pu_ward_col": "ward",
    "pu_lga_col": "lga",
    "pu_state_col": "state",
    "pu_registered_voters_col": "registered_voters",
    "ward_name_col": "ward_name",
    "ward_lga_col": "lga_name",
    "ward_state_col": "state_name",
}


def normalize_text(value: object) -> str:
    """Uppercase text, trim whitespace, and remove special characters."""
    if pd.isna(value):
        return ""

    text = str(value).strip().upper()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"[^A-Z0-9]+", "", text)
    return text


def normalize_label(value: object) -> str:
    """Clean text for display while keeping it readable."""
    if pd.isna(value):
        return ""
    return str(value).strip()


def require_columns(frame: pd.DataFrame, columns: list[str], label: str) -> None:
    missing = [column for column in columns if column not in frame.columns]
    if missing:
        raise ValueError(f"{label} is missing required columns: {', '.join(missing)}")


def add_join_keys(
    frame: pd.DataFrame,
    ward_col: str,
    lga_col: str,
    state_col: str | None = None,
) -> pd.DataFrame:
    frame = frame.copy()
    frame["ward_key"] = frame[ward_col].map(normalize_text)
    frame["lga_key"] = frame[lga_col].map(normalize_text)
    if state_col and state_col in frame.columns:
        frame["state_key"] = frame[state_col].map(normalize_text)
    return frame


def clean_registered_voters(frame: pd.DataFrame, voters_col: str) -> pd.DataFrame:
    frame = frame.copy()
    frame[voters_col] = (
        frame[voters_col]
        .astype(str)
        .str.replace(",", "", regex=False)
        .str.strip()
    )
    frame[voters_col] = pd.to_numeric(frame[voters_col], errors="coerce").fillna(0)
    return frame


def pick_extreme_pu_name(group: pd.DataFrame, voters_col: str, name_col: str, mode: str) -> str:
    if group.empty:
        return ""

    ordered = group.sort_values(
        by=[voters_col, name_col],
        ascending=[mode == "min", True],
        kind="mergesort",
    )
    return normalize_label(ordered.iloc[0][name_col])


def build_ward_statistics(
    pu_df: pd.DataFrame,
    voters_col: str,
    pu_name_col: str,
) -> pd.DataFrame:
    grouped = pu_df.groupby(["ward_key", "lga_key"], dropna=False, sort=False)

    stats = grouped.agg(
        pu_count=(pu_name_col, "size"),
        total_registered_voters=(voters_col, "sum"),
    ).reset_index()

    max_names = (
        grouped.apply(lambda group: pick_extreme_pu_name(group, voters_col, pu_name_col, "max"))
        .reset_index(name="max_voters_pu")
    )

    min_names = (
        grouped.apply(lambda group: pick_extreme_pu_name(group, voters_col, pu_name_col, "min"))
        .reset_index(name="min_voters_pu")
    )

    stats = stats.merge(max_names, on=["ward_key", "lga_key"], how="left")
    stats = stats.merge(min_names, on=["ward_key", "lga_key"], how="left")

    stats["avg_voters_per_pu"] = stats["total_registered_voters"] / stats["pu_count"]
    stats["avg_voters_per_pu"] = stats["avg_voters_per_pu"].round(2)
    stats["single_pu_ward"] = stats["pu_count"] == 1

    def classify_density(value: float) -> str:
        if pd.isna(value) or value < 200:
            return "LOW"
        if value <= 500:
            return "MEDIUM"
        return "HIGH"

    stats["voter_density_class"] = stats["avg_voters_per_pu"].map(classify_density)
    return stats


def find_unmatched_pus(pu_df: pd.DataFrame, ward_keys: pd.DataFrame) -> pd.DataFrame:
    merged = pu_df.merge(ward_keys, on=["ward_key", "lga_key"], how="left", indicator=True)
    unmatched = merged[merged["_merge"] == "left_only"].drop(columns=["_merge"])
    return unmatched


def main() -> None:
    parser = argparse.ArgumentParser(description="Ward-level polling unit analysis.")
    parser.add_argument("--polling-csv", default=DEFAULTS["polling_csv"])
    parser.add_argument("--wards-shp", default=DEFAULTS["wards_shp"])
    parser.add_argument("--output-gpkg", default=DEFAULTS["output_gpkg"])
    parser.add_argument("--output-layer", default=DEFAULTS["output_layer"])
    parser.add_argument("--summary-json", default=DEFAULTS["summary_json"])
    parser.add_argument("--stats-csv", default=DEFAULTS["stats_csv"])
    parser.add_argument("--unmatched-csv", default=DEFAULTS["unmatched_csv"])
    parser.add_argument("--pu-code-col", default=DEFAULTS["pu_code_col"])
    parser.add_argument("--pu-name-col", default=DEFAULTS["pu_name_col"])
    parser.add_argument("--pu-ward-col", default=DEFAULTS["pu_ward_col"])
    parser.add_argument("--pu-lga-col", default=DEFAULTS["pu_lga_col"])
    parser.add_argument("--pu-state-col", default=DEFAULTS["pu_state_col"])
    parser.add_argument("--pu-registered-voters-col", default=DEFAULTS["pu_registered_voters_col"])
    parser.add_argument("--ward-name-col", default=DEFAULTS["ward_name_col"])
    parser.add_argument("--ward-lga-col", default=DEFAULTS["ward_lga_col"])
    parser.add_argument("--ward-state-col", default=DEFAULTS["ward_state_col"])
    args = parser.parse_args()

    polling_csv = Path(args.polling_csv)
    wards_shp = Path(args.wards_shp)
    output_gpkg = Path(args.output_gpkg)
    summary_json = Path(args.summary_json)
    stats_csv = Path(args.stats_csv)
    unmatched_csv = Path(args.unmatched_csv)

    pu_df = pd.read_csv(polling_csv)
    wards_gdf = gpd.read_file(wards_shp)
    total_pus = len(pu_df)

    require_columns(
        pu_df,
        [args.pu_code_col, args.pu_name_col, args.pu_ward_col, args.pu_lga_col, args.pu_state_col, args.pu_registered_voters_col],
        "Polling unit CSV",
    )
    require_columns(
        wards_gdf,
        [args.ward_name_col, args.ward_lga_col, args.ward_state_col],
        "Ward shapefile",
    )

    pu_df = clean_registered_voters(pu_df, args.pu_registered_voters_col)
    pu_df = add_join_keys(pu_df, args.pu_ward_col, args.pu_lga_col, args.pu_state_col)
    matchable_pu_df = pu_df[pu_df["ward_key"].ne("") & pu_df["lga_key"].ne("")].copy()

    wards_gdf = wards_gdf.copy()
    if wards_gdf.crs is None:
        wards_gdf = wards_gdf.set_crs(epsg=4326)
    else:
        wards_gdf = wards_gdf.to_crs(epsg=4326)
    wards_gdf = add_join_keys(wards_gdf, args.ward_name_col, args.ward_lga_col, args.ward_state_col)

    stats = build_ward_statistics(
        pu_df=matchable_pu_df,
        voters_col=args.pu_registered_voters_col,
        pu_name_col=args.pu_name_col,
    )

    ward_keys = wards_gdf[["ward_key", "lga_key"]].drop_duplicates()
    unmatched_pus = find_unmatched_pus(pu_df, ward_keys)
    unmatched_pus = unmatched_pus.rename(
        columns={
            args.pu_code_col: "pu_code",
            args.pu_name_col: "pu_name",
            args.pu_ward_col: "ward",
            args.pu_lga_col: "lga",
            args.pu_state_col: "state",
            args.pu_registered_voters_col: "registered_voters",
        }
    )

    unmatched_pus["match_status"] = "no_matching_ward_boundary"
    unmatched_csv.parent.mkdir(parents=True, exist_ok=True)
    unmatched_pus.to_csv(unmatched_csv, index=False)

    ward_stats_columns = [
        "ward_key",
        "lga_key",
        "pu_count",
        "total_registered_voters",
        "avg_voters_per_pu",
        "max_voters_pu",
        "min_voters_pu",
        "single_pu_ward",
        "voter_density_class",
    ]
    wards_gdf = wards_gdf.merge(stats[ward_stats_columns], on=["ward_key", "lga_key"], how="left")

    wards_gdf["pu_count"] = wards_gdf["pu_count"].fillna(0).astype(int)
    wards_gdf["total_registered_voters"] = wards_gdf["total_registered_voters"].fillna(0).astype(float)
    wards_gdf["avg_voters_per_pu"] = wards_gdf["avg_voters_per_pu"].fillna(0).astype(float)
    wards_gdf["max_voters_pu"] = wards_gdf["max_voters_pu"].fillna("")
    wards_gdf["min_voters_pu"] = wards_gdf["min_voters_pu"].fillna("")
    wards_gdf["single_pu_ward"] = wards_gdf["single_pu_ward"].fillna(False).astype(bool)
    wards_gdf["voter_density_class"] = wards_gdf["voter_density_class"].fillna("LOW")

    stats_csv.parent.mkdir(parents=True, exist_ok=True)
    wards_gdf.drop(columns="geometry").to_csv(stats_csv, index=False)

    if "state_name" not in wards_gdf.columns and args.ward_state_col in wards_gdf.columns:
        wards_gdf["state_name"] = wards_gdf[args.ward_state_col]

    output_gpkg.parent.mkdir(parents=True, exist_ok=True)
    wards_gdf.to_file(output_gpkg, layer=args.output_layer, driver="GPKG")

    total_wards_matched = int((wards_gdf["pu_count"] > 0).sum())
    total_unmatched_pus = len(unmatched_pus)
    matched_wards = wards_gdf[wards_gdf["pu_count"] > 0].copy()
    most_pus = None
    fewest_pus = None

    print("Ward polling unit analysis complete")
    print(f"Total PUs: {total_pus}")
    print(f"Total wards matched: {total_wards_matched}")
    print(f"Total unmatched PUs: {total_unmatched_pus}")

    if not matched_wards.empty:
        most_pus_row = matched_wards.sort_values(["pu_count", args.ward_state_col, args.ward_lga_col, args.ward_name_col], ascending=[False, True, True, True]).iloc[0]
        fewest_pus_row = matched_wards.sort_values(["pu_count", args.ward_state_col, args.ward_lga_col, args.ward_name_col], ascending=[True, True, True, True]).iloc[0]
        most_pus = {
            "ward": normalize_label(most_pus_row[args.ward_name_col]),
            "lga": normalize_label(most_pus_row[args.ward_lga_col]),
            "state": normalize_label(most_pus_row[args.ward_state_col]),
            "pu_count": int(most_pus_row["pu_count"]),
        }
        fewest_pus = {
            "ward": normalize_label(fewest_pus_row[args.ward_name_col]),
            "lga": normalize_label(fewest_pus_row[args.ward_lga_col]),
            "state": normalize_label(fewest_pus_row[args.ward_state_col]),
            "pu_count": int(fewest_pus_row["pu_count"]),
        }

        print(
            "Ward with most PUs: "
            f"{most_pus_row[args.ward_name_col]} | {most_pus_row[args.ward_lga_col]} | "
            f"{most_pus_row[args.ward_state_col]} ({int(most_pus_row['pu_count'])})"
        )
        print(
            "Ward with fewest PUs: "
            f"{fewest_pus_row[args.ward_name_col]} | {fewest_pus_row[args.ward_lga_col]} | "
            f"{fewest_pus_row[args.ward_state_col]} ({int(fewest_pus_row['pu_count'])})"
        )
    else:
        print("Ward with most PUs: --")
        print("Ward with fewest PUs: --")

    summary_json.parent.mkdir(parents=True, exist_ok=True)
    summary = {
        "total_pus": total_pus,
        "total_wards_matched": total_wards_matched,
        "total_unmatched_pus": total_unmatched_pus,
        "most_pus_ward": most_pus,
        "fewest_pus_ward": fewest_pus,
        "output_gpkg": str(output_gpkg),
        "output_layer": args.output_layer,
        "unmatched_csv": str(unmatched_csv),
        "stats_csv": str(stats_csv),
    }
    summary_json.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"Saved unmatched PUs to: {unmatched_csv}")
    print(f"Saved GeoPackage to: {output_gpkg} [{args.output_layer}]")
    print(f"Saved summary JSON to: {summary_json}")


if __name__ == "__main__":
    main()
