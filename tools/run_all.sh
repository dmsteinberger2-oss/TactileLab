#!/bin/sh
# one process per variant keeps peak memory low
set -e
OUT=${1:-generated}
for st in normal t1a t1b t2a t3a; do
  for fm in whole coronal; do
    python3 tools/kidney_sdf.py "$OUT" $st $fm
  done
done
