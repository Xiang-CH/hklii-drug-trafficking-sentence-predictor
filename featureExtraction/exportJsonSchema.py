import os
import json

from schema import Trials, Judgement, Defendants

schemas = [
    (Trials, "trials"),
    (Judgement, "judgement"),
    (Defendants, "defendants"),
]


def export_schema(schema_class, output_path):
    schema = schema_class.model_json_schema()
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(schema, f, indent=4)


if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.abspath(__file__))
    for schema_class, filename in schemas:
        export_schema(
            schema_class,
            os.path.join(base_dir, "schema", "jsonSchema", f"{filename}.json"),
        )
