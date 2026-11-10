from PIL import Image, ImageDraw, ImageFilter
import numpy as np, os
from collections import deque
im=Image.open('/private/tmp/claude-501/-Users-leomoutinho-Documents-Central-de-Vagas/8d5acc32-e4a0-4f0b-b75d-78d91d6379f5/images/4.png').convert('RGB')
a=np.asarray(im).astype(np.float32);H,W,_=a.shape;mn=a.min(axis=2)
def fill(seeds,ok,box=None):
  R=np.zeros((H,W),bool);q=deque()
  for s in seeds:
    if ok[s]:R[s]=True;q.append(s)
  while q:
    y,x=q.popleft()
    for dy,dx in((1,0),(-1,0),(0,1),(0,-1)):
      ny,nx=y+dy,x+dx
      if 0<=ny<H and 0<=nx<W and ok[ny,nx] and not R[ny,nx]:
        if box and not(box[0]<=nx<=box[2] and box[1]<=ny<=box[3]):continue
        R[ny,nx]=True;q.append((ny,nx))
  return R
border=[(y,0) for y in range(H)]+[(y,W-1) for y in range(H)]+[(0,x) for x in range(W)]+[(H-1,x) for x in range(W)]
BG=fill(border,mn>=140)
# olhos das máscaras: semeia dentro de cada olho e enche só o branco, preso numa caixa
EYES=[((247,52),(20,220,95,270)),((240,125),(95,215,160,265)),((240,637),(605,215,675,265)),((240,718),(690,215,750,265))]
EY=np.zeros((H,W),bool)
for (sy,sx),box in EYES:
  # acha o pixel mais claro perto da semente
  ys,xs=np.mgrid[sy-8:sy+9,sx-8:sx+9];k=np.argmax(mn[ys,xs]);s=(int(ys.flat[k]),int(xs.flat[k]))
  r=fill([s],mn>=200,box);print('olho',s,int(r.sum()));EY|=r
EYd=np.asarray(Image.fromarray((EY*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)))>0
CL=BG|EYd
alpha=np.clip(((255-a).max(axis=2))/255,0,1)
f=(a-(1-alpha[...,None])*255)/np.maximum(alpha[...,None],1e-3)
out=np.zeros((H,W,4),np.float32)
out[...,:3]=np.where(CL[...,None],np.clip(f,0,255),a);out[...,3]=np.where(CL,alpha*255,255)
full=Image.fromarray(out.astype(np.uint8))
TOP,BOT=95,640
def poly(pts):
  m=Image.new('L',(W,H),0);ImageDraw.Draw(m).polygon(pts,fill=255);return m
L=[(0,110),(222,110),(226,372),(268,386),(256,470),(240,548),(0,566)]
Rp=[(W-x,y) for x,y in L]
mL,mR=poly(L),poly(Rp)
# camada do braço um pouco maior (entra no tronco por trás do corpo)
mLb=mL.filter(ImageFilter.MaxFilter(41));mRb=mR.filter(ImageFilter.MaxFilter(41))
def layer(mask):
  o=Image.new('RGBA',(W,H),(0,0,0,0));o.paste(full,(0,0),mask)
  # mantém o alpha original dentro da máscara
  arr=np.asarray(full).copy();m=np.asarray(mask)>0;arr[~m]=0;return Image.fromarray(arr)
body=np.asarray(full).copy();body[(np.asarray(mL)>0)|(np.asarray(mR)>0)]=0
layers={'corpo':Image.fromarray(body),'bracoE':layer(mLb),'bracoD':layer(mRb)}
for k,v in layers.items():
  v=v.crop((0,TOP,W,BOT));v.save(k+'.webp','WEBP',quality=86,method=6);print(k,os.path.getsize(k+'.webp'))
# prévia: camadas juntas sobre fundo escuro + braço esquerdo levantado
def comp(angL=0,angR=0):
  bg=Image.new('RGBA',(W,BOT-TOP),(10,8,8,255))
  for k,ang,piv in (('bracoE',angL,(250,450-TOP)),('bracoD',angR,(W-250,450-TOP))):
    l=Image.open(k+'.webp').convert('RGBA').rotate(ang,center=piv,resample=Image.BICUBIC);bg.alpha_composite(l)
  bg.alpha_composite(Image.open('corpo.webp').convert('RGBA'));return bg
a1=comp();a2=comp(-14,14)
pv=Image.new('RGB',(W*2+10,BOT-TOP),(40,40,40));pv.paste(a1.convert('RGB'),(0,0));pv.paste(a2.convert('RGB'),(W+10,0));pv.save('prev2.png')
