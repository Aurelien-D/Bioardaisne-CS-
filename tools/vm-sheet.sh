#!/bin/sh
# Contact sheet of the eight weapons in first-person view: tools/vm-sheet.sh [extra query, e.g. "&ads=1"] -> tools/out/vm/sheet.jpg
cd "$(dirname "$0")/.." || exit 1
mkdir -p tools/out/vm
for w in knife pistol deagle smg rifle_ak rifle_m4 shotgun sniper; do
  node tools/shot-dev.cjs "/dev/viewmodel.html?w=$w$1" tools/out/vm/hip_$w.png --size 640x360 --port 5341 >/dev/null 2>&1
done
python3 -I - <<'PY'
from PIL import Image, ImageDraw
ws=['knife','pistol','deagle','smg','rifle_ak','rifle_m4','shotgun','sniper']
W,H=640,360
sheet=Image.new('RGB',(W*4,H*2))
d=ImageDraw.Draw(sheet)
for i,w in enumerate(ws):
    try: im=Image.open(f'tools/out/vm/hip_{w}.png').convert('RGB')
    except Exception: im=Image.new('RGB',(W,H),(80,0,0))
    sheet.paste(im,((i%4)*W,(i//4)*H)); d.text(((i%4)*W+8,(i//4)*H+8),w,fill=(255,255,0))
sheet.save('tools/out/vm/sheet.jpg',quality=82)
PY
echo tools/out/vm/sheet.jpg
