"""Build attributed, versioned static GeoNames city shards; never used at runtime.
Download cities500.zip, admin1CodesASCII.txt and countryInfo.txt from
https://download.geonames.org/export/dump/ into a local directory, then pass it.
"""
import hashlib, json, pathlib, sys, zipfile
root=pathlib.Path(sys.argv[1]); out=pathlib.Path(__file__).resolve().parents[1]
names=['cities500.zip','admin1CodesASCII.txt','countryInfo.txt']
hashes={n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in names}
version=hashlib.sha256(json.dumps(hashes,sort_keys=True).encode()).hexdigest()[:12]
regions={}
for line in (root/names[1]).read_text().splitlines():
 p=line.split('\t')
 if len(p)>=3: regions[p[0]]=list(dict.fromkeys([p[1],p[2]]))
countries={}
for line in (root/names[2]).read_text().splitlines():
 if not line or line.startswith('#'): continue
 p=line.split('\t'); countries[p[0]]={'names':[p[0],p[1],p[4]],'regions':{}}
shards={}
with zipfile.ZipFile(root/names[0]) as z:
 for line in z.read('cities500.txt').decode().splitlines():
  p=line.split('\t'); code=p[8]
  if code not in countries or not p[17]: continue
  aliases=list(dict.fromkeys([p[1],p[2]]))
  # Keep alternate names to support common local/English spellings.
  aliases+= [a for a in p[3].split(',') if a and len(a)<80 and a not in aliases][:8]
  shards.setdefault(code,[]).append([aliases,p[10],p[17]])
  countries[code]['regions'][p[10]]=regions.get(code+'.'+p[10],[p[10]])
folder=out/'public'/'location-data'/version; folder.mkdir(parents=True,exist_ok=True)
for code,rows in sorted(shards.items()):
 (folder/(code+'.json')).write_text(json.dumps({'version':version,'country':code,'cities':rows},ensure_ascii=False,separators=(',',':'))+'\n')
manifest={'version':version,'source':'https://download.geonames.org/export/dump/','license':'CC BY 4.0','hashes':hashes,'countries':{c:countries[c] for c in sorted(shards)}}
(out/'src'/'location-data-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n')
(folder/'NOTICE.txt').write_text('Contains GeoNames data, https://www.geonames.org/, licensed CC BY 4.0: https://creativecommons.org/licenses/by/4.0/.\nDerived city/name/region/time-zone lookup; no accuracy or completeness warranty.\nSource SHA-256: '+json.dumps(hashes,sort_keys=True)+'\n')
print(json.dumps({'version':version,'countries':len(shards),'cities':sum(map(len,shards.values())),'bytes':sum(p.stat().st_size for p in folder.iterdir())}))
