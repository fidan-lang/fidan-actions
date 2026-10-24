"""Fail closed on executable expression interpolation and mutable action dependencies.

Requires PyYAML 6.0.3. Pass one or more repository roots; no network or secrets used.
Expressions in env/with/if/names are data, not executable shell source.
"""
import argparse
import json
from pathlib import Path
import re
import sys
import yaml

class WorkflowLoader(yaml.BaseLoader):
    pass

def unique_mapping(loader, node):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node)
        if key in result:
            raise ValueError(f"Duplicate YAML key: {key}")
        result[key] = loader.construct_object(value_node)
    return result

WorkflowLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)
STALE_SETUP = "ac9b0694edb6c4a6cbef3c2642e3f3aafacfd820"

def check_document(document):
    errors = []
    def visit(value, location):
        if isinstance(value, dict):
            for key, child in value.items():
                here = f"{location}.{key}"
                if key in ("run", "script") and isinstance(child, str) and "${{" in child:
                    errors.append(f"{here}: expression in executable source; pass data through env")
                if key == "uses" and isinstance(child, str) and not child.startswith(("./", "docker://")):
                    if not re.fullmatch(r"[^@]+@[a-fA-F0-9]{40}", child):
                        errors.append(f"{here}: immutable full action SHA required")
                    if child.startswith("fidan-lang/fidan-actions/") and STALE_SETUP in child:
                        errors.append(f"{here}: stale unaudited Setup Action")
                visit(child, here)
            if value.get("repository") == "fidan-lang/fidan-actions":
                if not re.fullmatch(r"[a-fA-F0-9]{40}|\$\{\{.*\}\}", str(value.get("ref", ""))):
                    errors.append(f"{location}: Setup Action checkout requires an immutable SHA (validate dynamic refs before checkout)")
        elif isinstance(value, list):
            for i, child in enumerate(value):
                visit(child, f"{location}[{i}]")
    visit(document, "workflow")
    return errors

def check_roots(roots):
    errors, count = [], 0
    for root in roots:
        root = Path(root)
        paths = list((root / ".github/workflows").glob("*.y*ml"))
        paths += [p for p in (root / "setup").glob("action.y*ml")]
        candidate_file = root / "ci/compiler-candidate.json"
        if candidate_file.is_file():
            contract = json.loads(candidate_file.read_text(encoding="utf-8"))
            expected_setup = contract.get("setup_sha", "")
            if not re.fullmatch(r"[a-f0-9]{40}", str(expected_setup)):
                errors.append(f"{candidate_file}: exact audited Setup SHA required")
            for path in paths:
                document = yaml.load(path.read_text(encoding="utf-8"), Loader=WorkflowLoader)
                for job in document.get("jobs", {}).values():
                    for step in job.get("steps", []):
                        checkout = step.get("with", {})
                        if checkout.get("repository") == "fidan-lang/fidan-actions" and checkout.get("ref") != expected_setup:
                            errors.append(f"{path}: Setup checkout differs from candidate contract")
                        uses = step.get("uses", "")
                        if uses.startswith("fidan-lang/fidan-actions/") and uses.split("@")[-1] != expected_setup:
                            errors.append(f"{path}: Setup pin differs from candidate contract")
        for path in sorted(paths):
            count += 1
            try:
                document = yaml.load(path.read_text(encoding="utf-8"), Loader=WorkflowLoader)
                if not isinstance(document, dict):
                    raise ValueError("Expected workflow mapping")
                errors.extend(f"{path}: {e}" for e in check_document(document))
            except (ValueError, yaml.YAMLError) as error:
                errors.append(f"{path}: {error}")
    if not count:
        errors.append("No workflows found; check repository roots")
    return count, errors

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("roots", nargs="+")
    args = parser.parse_args()
    count, errors = check_roots(args.roots)
    for error in errors:
        print(error, file=sys.stderr)
    print(f"Checked {count} workflow/action files; {len(errors)} violations")
    sys.exit(bool(errors))
