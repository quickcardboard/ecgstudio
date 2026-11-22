#!/bin/bash
# make_variant.sh <name> : a working copy of the model on the SSM variant ssm/<name>.npz, with its own torso field
set -e
S=${SSM_WORK:?set SSM_WORK to a work directory (ssm/<name>.npz inside)}; R=$(cd "$(dirname "$0")/../.." && pwd); N=$1; V=$S/var/$N
rm -rf $V; mkdir -p $V; cp -r $R/src $R/tools $V/
python3 $R/tools/build_anatomy.py $S/ssm/$N.npz $V/src > $V/build.log 2>&1 || grep -q "^dims" $V/build.log   # (the preview images need matplotlib: the anatomy is written before them)
test -s $V/src/anatomy.json
python3 $R/tools/ssm/seal.py $V/src/anatomy.json > $V/seal.log
cd $V && node tools/export_heart_torso.js $V/heart.json > $V/export.log && ANISO=1 python3 tools/torso_v2.py $V/heart.json $V/src/torso_limb.json 3 > $V/torso.log 2>&1
echo "$N built: $(grep -o 'voxels [0-9]*' $V/build.log) $(grep 'frontal angle' $V/torso.log | tr '\n' ' ')"
