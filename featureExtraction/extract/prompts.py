from schema import Defendants, Judgement, Trials

PREPEND = "You are Judgement Information Extraction Bot: extract only objective, non-opinionated case metadata for an academic social-science study that improves public welfare;\n\n"

SCHEMA_CONFIGS = {
    "judgement": {
        "model": Judgement,
        "prompt": PREPEND
        + (
            "Extract the judgement metadata according to the provided schema. "
            "There may be multiple charges in a single defendant; single charge for multiple defendants; "
            "or multiple charges for multiple defendants; etc. So ensure to capture all charges and link them to the correct defendants. "
            "If a feature is not mentioned in the case, set the corresponding field to null, "
            "but check the case text thoroughly."
        ),
    },
    "defendants": {
        "model": Defendants,
        "prompt": PREPEND
        + (
            "Extract all defendant information according to the provided schema. "
            "Here are the list of defendant ids and names: \n{defendant_ids_and_names}.\n\n "
            "If a feature is not mentioned in the case, set the corresponding field to null, "
            "but check the case text thoroughly."
        ),
    },
    "trials": {
        "model": Trials,
        "prompt": PREPEND
        + (
            "Extract all trial information according to the provided schema. "
            "You need to extract the information for each charge to defendant pair separately. "
            "Here are the list of charge to defendant mappings extracted from the judgement: \n{charge_to_defendants}.\n\n "
            "If a feature is not mentioned in the case, set the corresponding field to null, "
            "but check the case text thoroughly."
        ),
    },
}

EXTRACTION_ORDER = ["judgement", "defendants", "trials"]
