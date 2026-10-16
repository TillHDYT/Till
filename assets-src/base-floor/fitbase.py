import numpy as np
P=[((1551,1659),(195,580)),((1748,2270),(230,505)),((2177,1807),(282,575)),((1171,3571),(172,310)),((3203,3208),(446,363)),((3452,1236),(475,652)),((1169,4287),(172,215)),((3651,3696),(502,300)),((4281,1253),(580,655))]
A=[];b=[]
for (X,Y),(u,v) in P:
  A.append([X,Y,1,0,0,0]); b.append(u); A.append([0,0,0,X,Y,1]); b.append(v)
sol,*_=np.linalg.lstsq(np.array(A,float),np.array(b,float),rcond=None)
M=sol.reshape(2,3)
for (X,Y),(u,v) in P:
  p=M@[X,Y,1]; print((X,Y),(u,v),'res %.1f %.1f'%(p[0]-u,p[1]-v))
print(M); np.save('Mbase.npy',M)
print('mid inner predicted', M@[5048,4812,1])
