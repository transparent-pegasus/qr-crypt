import json
import unittest
from urllib.parse import quote
from results import CHECK_NAMES, extract, validate


class ResultsTest(unittest.TestCase):
    def setUp(self):
        self.report = dict(origin="capacitor://localhost", href="capacitor://localhost/", userAgent="test", gestureMethod="not delivered", isSecureContext=True,
                           checks=[dict(name=name, ok=False, detail="NotAllowedError: exact error 日本語", ms=3) for name in CHECK_NAMES])

    def test_chunks_with_logcat_prefix_preserve_errors(self):
        encoded = quote(json.dumps(self.report, ensure_ascii=False), safe="")
        chunks = [encoded[i:i + 511] for i in range(0, len(encoded), 511)]
        log = "\n".join("logcat prefix Msg: G0R_RESULT " + str(i + 1) + "/" + str(len(chunks)) + " " + part for i, part in enumerate(chunks))
        self.assertEqual(extract(log), self.report)
        self.assertIsNone(extract(log.rsplit("\n", 1)[0]))

    def test_feature_failure_is_valid_but_partial_report_is_not(self):
        self.assertEqual(validate(self.report), self.report)
        self.report["checks"].pop()
        with self.assertRaises(AssertionError):
            validate(self.report)


if __name__ == "__main__":
    unittest.main()
