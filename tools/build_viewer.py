import sys
import json, base64
t = open('tools/viewer_template.html').read()
meta = json.dumps(json.load(open(sys.argv[1] + '/web_meta.json')), ensure_ascii=False).replace('</', '<\\/')
man = json.dumps(json.load(open(sys.argv[1] + '/web.json'))).replace('</', '<\\/')
data = base64.b64encode(open(sys.argv[1] + '/web.bin.gz', 'rb').read()).decode()
out = t.replace('__META__', meta).replace('__MANIFEST__', man).replace('__DATA__', data)
open('/mnt/user-data/outputs/tactilelab_viewer.html', 'w').write(out)
print('MB', round(len(out.encode()) / 1e6, 2))
