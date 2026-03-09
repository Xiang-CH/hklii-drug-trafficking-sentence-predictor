import re

from bs4 import BeautifulSoup

from utils.htmlToText import html_to_text_with_tables


def build_case_text(judgement_doc: dict) -> tuple[str, str]:
    has_appeal = bool(judgement_doc.get("appeal"))
    has_corrigendum = bool(judgement_doc.get("corrigendum"))

    judgement_type = "standard"
    if has_appeal:
        judgement_type = "appeal"
    elif has_corrigendum:
        judgement_type = "corrigendum"

    case_txt = ""
    if judgement_doc.get("html"):
        case_html = BeautifulSoup(judgement_doc["html"], "html.parser")
        case_txt += html_to_text_with_tables(case_html)

    if has_appeal and judgement_doc.get("appeal_html"):
        appeal_html = BeautifulSoup(judgement_doc["appeal_html"], "html.parser")
        case_txt += html_to_text_with_tables(appeal_html)

    if has_corrigendum and judgement_doc.get("corrigendum_html"):
        corrigendum_html = BeautifulSoup(
            judgement_doc["corrigendum_html"], "html.parser"
        )
        case_txt += html_to_text_with_tables(corrigendum_html)

    case_txt = re.sub(r"\n\s*\n", "\n\n", case_txt).strip()

    return case_txt, judgement_type
