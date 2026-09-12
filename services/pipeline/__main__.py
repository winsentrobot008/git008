"""python -m services.pipeline 入口。"""

import sys

from services.pipeline.factory_pipeline import main

if __name__ == "__main__":
    sys.exit(main())
