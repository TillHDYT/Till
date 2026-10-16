import sys, numpy as np, json
from PIL import Image
P = [((981,10441),(148,295)),((1512,6699),(172,490)),((1169,4287),(143,622)),((5846,6396),(444,505)),((5048,4812),(395,587)),((3651,3696),(302,657)),((4281,1253),(340,792)),((6919,1483),(511,778)),((10504,1029),(747,807)),
((4318,13875),(357,132)),((7943,13411),(577,157)),((10481,13650),(730,137)),((8955,8510),(640,397)),((9767,10113),(690,317)),((11134,11207),(772,257)),((13624,10572),(927,292)),((13327,8226),(912,412)),((13866,4505),(959,610))]
def fit(P):
  A=[]
  for (X,Y),(u,v) in P:
    A.append([X,Y,1,0,0,0,-u*X,-u*Y,-u]); A.append([0,0,0,X,Y,1,-v*X,-v*Y,-v])
  A=np.array(A,float); _,_,Vt=np.linalg.svd(A); return Vt[-1].reshape(3,3)
# normalize
def tr(H,X,Y):
  p=H@[X,Y,1]; return p[0]/p[2],p[1]/p[2]
H=fit(P)
for (X,Y),(u,v) in P:
  a,b=tr(H,X,Y); print((X,Y),(u,v),'res %.1f %.1f'%(a-u,b-v))
np.save('H.npy',H)
# rectify: output 1024x1024, lol coords 0..14870 ; out pixel (i,j): X=i/1024*14870, Y=(1-j/1024)*14870
im=np.asarray(Image.open(sys.argv[1] if len(sys.argv) > 1 else 'map.webp').convert('RGB')).astype(float)
N=1024; L=14870
j,i=np.mgrid[0:N,0:N]
X=(i+0.5)/N*L; Y=(1-(j+0.5)/N)*L
den=H[2,0]*X+H[2,1]*Y+H[2,2]
u=(H[0,0]*X+H[0,1]*Y+H[0,2])/den; v=(H[1,0]*X+H[1,1]*Y+H[1,2])/den
# bilinear
u0=np.clip(np.floor(u).astype(int),0,im.shape[1]-2); v0=np.clip(np.floor(v).astype(int),0,im.shape[0]-2)
fu=(u-u0)[...,None]; fv=(v-v0)[...,None]
out=im[v0,u0]*(1-fu)*(1-fv)+im[v0,u0+1]*fu*(1-fv)+im[v0+1,u0]*(1-fu)*fv+im[v0+1,u0+1]*fu*fv
Image.fromarray(out.astype(np.uint8)).save(sys.argv[2] if len(sys.argv) > 2 else 'rect.png')
