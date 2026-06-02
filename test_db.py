import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()
uri = os.getenv("DB_MONGODB_URI")
client = MongoClient(uri)
db = client.get_database("drug-sentencing-predictor")

vf = db["verified-features"].find_one()
print(f"sourceJudgementId in verified-features: {vf.get('sourceJudgementId')} (type: {type(vf.get('sourceJudgementId'))})")

jh = db["judgement-html"].find_one()
print(f"_id in judgement-html: {jh.get('_id')} (type: {type(jh.get('_id'))})")
print(f"neutral_citation in judgement-html: {jh.get('neutral_citation')}")
print(f"assigned_to in judgement-html: {jh.get('assigned_to')}")