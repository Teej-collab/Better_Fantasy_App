import sys,os,glob,subprocess
d,out=sys.argv[1],sys.argv[2]; n=int(sys.argv[3]) if len(sys.argv)>3 else 8
fs=sorted(glob.glob(d+"/f_*.jpg")); ts=[int(os.path.basename(f)[2:9]) for f in fs]
end=ts[-1]; picks=[]
for i in range(n):
    t=end*i/(n-1); j=max(k for k in range(len(ts)) if ts[k]<=t or k==0); picks.append(fs[j])
args=[];[args.extend(["-i",p]) for p in picks]
cols=4; rows=(n+cols-1)//cols
fc="".join(f"[{i}]scale=640:-2[s{i}];" for i,p in enumerate(picks))
fc+="".join(f"[s{i}]" for i in range(n))+f"xstack=inputs={n}:grid={cols}x{rows}"
subprocess.run(["ffmpeg","-loglevel","error","-y",*args,"-filter_complex",fc,out],check=True)
print(end, len(fs), [ts[fs.index(p)] for p in picks])
