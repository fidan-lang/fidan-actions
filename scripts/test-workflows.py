import importlib.util
from pathlib import Path
import unittest
import tempfile
import json
import yaml

spec = importlib.util.spec_from_file_location("check_workflows", Path(__file__).with_name("check-workflows.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

class WorkflowSecurityTests(unittest.TestCase):
    def test_executable_contexts_reject_all_expression_sources(self):
        for expression in ("inputs.version", "github.ref_name", "github.event.pull_request.title", "matrix.platform", "steps.source.outputs.url", "secrets.CERT_PASSWORD"):
            for key in ("run", "script"):
                with self.subTest(expression=expression, key=key):
                    self.assertTrue(gate.check_document({"steps": [{key: 'echo "${{ ' + expression + ' }}"'}]}))

    def test_data_contexts_and_quoted_environment_are_allowed(self):
        self.assertEqual(gate.check_document({"env": {"VERSION": "${{ inputs.version }}"}, "steps": [{"run": 'printf "%s" "$VERSION"'}], "if": "${{ inputs.publish }}"}), [])

    def test_immutable_action_and_checkout_pins(self):
        self.assertEqual(gate.check_document({"uses": "actions/checkout@" + "a" * 40}), [])
        for ref in ("main", "v1", "${{ inputs.sha }}", "abc"):
            self.assertTrue(gate.check_document({"uses": "fidan-lang/fidan-actions/setup@" + ref}))
            if "${{" not in ref:
                self.assertTrue(gate.check_document({"with": {"repository": "fidan-lang/fidan-actions", "ref": ref}}))
        self.assertTrue(gate.check_document({"uses": "fidan-lang/fidan-actions/setup@" + gate.STALE_SETUP}))

    def test_consumer_pin_must_match_its_candidate_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "ci").mkdir()
            (root / ".github/workflows").mkdir(parents=True)
            (root / "ci/compiler-candidate.json").write_text(json.dumps({"setup_sha": "a" * 40}))
            workflow = root / ".github/workflows/ci.yaml"
            workflow.write_text("jobs:\n  test:\n    steps:\n      - uses: actions/checkout@" + "b" * 40 + "\n        with:\n          repository: fidan-lang/fidan-actions\n          ref: " + "c" * 40 + "\n")
            self.assertTrue(gate.check_roots([root])[1])
            workflow.write_text(workflow.read_text().replace("c" * 40, "a" * 40))
            self.assertEqual(gate.check_roots([root])[1], [])

    def test_duplicate_yaml_keys_fail_closed(self):
        with self.assertRaises(ValueError):
            yaml.load("jobs: {}\njobs: {}", Loader=gate.WorkflowLoader)

if __name__ == "__main__":
    unittest.main()
