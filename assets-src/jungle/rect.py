"""Entzerrt die Kluft-Vorlage (kluft.webp, schräge Draufsicht) auf 1024² in LoL-Koordinaten 0..14870.

Passpunkte sind Nexus, Inhibitoren und Türme (Bildpixel <-> LoL-Koordinaten der Gebäude in mapdata.ts); Homographie
plus Thin-Plate-Korrektur, damit jeder Turm genau auf seiner Stelle im Bild liegt. Ergebnis ist die Vorlage für mask.py.
Aufruf: python3 rect.py kluft.webp rect.png
"""
import sys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
# Blau: (LoL-Koordinate, Bildpixel); Rot: Gebäude der blauen Seite punktgespiegelt
from PIL import Image
B=[((1543,1661),(190,596)),((1230,3593),(173.5,514)),((3213,3251),(280,532)),((3537,1243),(294,622)),
((1192,4254),(175,472)),((3588,3695),(307,502)),((4290,1233),(338.5,617)),((1512,6699),(194,372)),
((5048,4812),(381,457)),((6919,1483),(481,612)),((981,10441),(172.5,220)),((10504,1029),(676,634)),
((1724,2242),(202.5,565)),((2125,1760),(226.5,585))]
R=[((1543,1661),(782.5,122)),((1230,3593),(810,195)),((3213,3251),(707.5,182)),((3537,1243),(686.5,102)),
((1192,4254),(813.5,222)),((3588,3695),(685,192)),((4290,1233),(648.5,97)),((1512,6699),(805,322)),
((6919,1483),(521,102)),((981,10441),(844,480)),((10504,1029),(341.5,87))]
P=[(a,b) for a,b in B]+[((14870-a[0],14870-a[1]),b) for a,b in R]
def fit(P):
  A=[]
  for (X,Y),(u,v) in P:
    A.append([X,Y,1,0,0,0,-u*X,-u*Y,-u]); A.append([0,0,0,X,Y,1,-v*X,-v*Y,-v])
  A=np.array(A,float); _,_,Vt=np.linalg.svd(A); return Vt[-1].reshape(3,3)
H=fit(P)
def hom(X,Y):
  den=H[2,0]*X+H[2,1]*Y+H[2,2]
  return (H[0,0]*X+H[0,1]*Y+H[0,2])/den,(H[1,0]*X+H[1,1]*Y+H[1,2])/den
C=np.array([a for a,_ in P],float)/14870; T=np.array([b for _,b in P],float)
hu,hv=hom(C[:,0]*14870,C[:,1]*14870); res=T-np.stack([hu,hv],1)
print('rms res',np.sqrt((res**2).sum(1).mean()))
def K(r): return np.where(r>0,r*r*np.log(r+1e-12),0)
n=len(C); D=np.hypot(*(C[:,None]-C[None]).transpose(2,0,1))
A=np.zeros((n+3,n+3)); A[:n,:n]=K(D)+np.eye(n)*0.002; A[:n,n]=1; A[:n,n+1:]=C; A[n,:n]=1; A[n+1:,:n]=C.T
W=np.linalg.solve(A,np.vstack([res,np.zeros((3,2))]))
def warp(X,Y):
  u,v=hom(X,Y); x=np.stack([X/14870,Y/14870],-1)
  d=np.hypot(*(x[...,None,:]-C).transpose(2,0,1,3) if False else (x[...,None,0]-C[:,0], x[...,None,1]-C[:,1]))
  k=K(d); du=k@W[:n,0]+W[n,0]+x[...,0]*W[n+1,0]+x[...,1]*W[n+2,0]; dv=k@W[:n,1]+W[n,1]+x[...,0]*W[n+1,1]+x[...,1]*W[n+2,1]
  return u+du,v+dv
im=np.asarray(Image.open(src).convert('RGB')).astype(float)
N=1024; L=14870
j,i=np.mgrid[0:N,0:N]
X=(i+0.5)/N*L; Y=(1-(j+0.5)/N)*L
u,v=warp(X,Y)
u0=np.clip(np.floor(u).astype(int),0,im.shape[1]-2); v0=np.clip(np.floor(v).astype(int),0,im.shape[0]-2)
fu=(u-u0)[...,None]; fv=(v-v0)[...,None]
img=im[v0,u0]*(1-fu)*(1-fv)+im[v0,u0+1]*fu*(1-fv)+im[v0+1,u0]*(1-fu)*fv+im[v0+1,u0+1]*fu*fv
Image.fromarray(img.astype(np.uint8)).save(out)
