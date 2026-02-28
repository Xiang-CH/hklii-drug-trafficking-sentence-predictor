# Agent Guidelines - Feature Extraction
Python project for extracting structured features from HK drug trafficking court judgments.

## Commands
```bash
cd featureExtraction
uv sync                # Install dependencies
uv run python script.py
uv run ruff check .    # Lint
uv run ruff format .   # Format
```
Always run `uv run ruff check .` after changes to ensure code quality and consistency.

## Style
- **snake_case** for functions/variables, **PascalCase** for classes
- **Type hints** required
- No comments unless asked

## Structure
- `schema/` - Pydantic models and validation
- `utils/` - Helper functions (htmlToText, hkDistricts, etc.)
- `sampleJudgments/` - Test HTML files
- `extractFeature.py` - Main extraction script
- `db.py` - MongoDB operations
