import pathlib

README = pathlib.Path(__file__).resolve().parents[2] / "README.md"


def test_readme_documents_new_methodology():
    t = README.read_text().lower()
    assert "flawed" in t                      # the 5th fixture regime
    assert "45" in t                          # 5 x 3 x 3 matrix
    assert "version.txt" in t                 # fixture-version convention
    assert "engine version" in t              # stamping + non-pooling
    assert "coverage" in t                    # plan-coverage column
    assert "freeze" in t                      # freeze-then-complete policy
