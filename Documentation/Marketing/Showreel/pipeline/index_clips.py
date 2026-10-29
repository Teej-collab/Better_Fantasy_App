import glob,os,json
idx={}
for d in sorted(glob.glob("clips/*")):
    if os.path.isdir(d):
        idx[os.path.basename(d)]=[int(os.path.basename(f)[2:9]) for f in sorted(glob.glob(d+"/f_*.jpg"))]
json.dump(idx,open("clips.json","w"))
print({k:(len(v),v[-1]) for k,v in idx.items()})
