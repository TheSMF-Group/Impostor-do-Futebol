import json,glob,os,sys
SRC=os.path.expanduser('~/Documents/thefenomeno-jogos'); OUT=sys.argv[1]
d=json.load(open(SRC+'/dados.json'));P=d['P'];C=d['C'];K={k[0]:k for k in d['K']}
F={}
for f in ['fotos.json','fotos-dificil.json']+[os.path.relpath(x,SRC) for x in glob.glob(SRC+'/fotos/s*.json')]: F.update(json.load(open(SRC+'/'+f)))
L=json.load(open(SRC+'/lendas.json'));E=json.load(open(SRC+'/escudos.json'))
AT=json.load(open(SRC+'/atuais.json'));POS=json.load(open(SRC+'/posicoes.json'))
def cidx(slug):
  # primary club index for slug: first index whose slug matches (lowest = most relevant)
  return [i for i,c in enumerate(C) if c[1]==slug]
BR14="flamengo palmeiras sao-paulo santos corinthians gremio internacional fluminense vasco cruzeiro atletico-mg bahia botafogo athletico-pr".split()
BRT=BR14+"mirassol bragantino vitoria-ba coritiba chapecoense remo".split()
SERIEB="fortaleza ceara sport-recife juventude goias america-mg criciuma cuiaba crb avai vila-nova novorizontino operario-pr botafogo-sp ponte-preta londrina nautico sao-bernardo".split()
EUT="real-madrid barcelona atletico sevilla valencia villarreal athletic sociedad betis man-city man-utd liverpool chelsea arsenal tottenham newcastle aston-villa west-ham everton juventus inter ac-milan napoli roma lazio atalanta fiorentina bayern dortmund leverkusen leipzig psg marseille lyon monaco lille benfica porto sporting braga ajax psv feyenoord galatasaray fenerbahce besiktas".split()
CL="real-madrid barcelona atletico athletic villarreal man-city liverpool chelsea arsenal tottenham newcastle inter napoli juventus atalanta bayern dortmund leverkusen frankfurt psg marseille monaco benfica sporting psv ajax brugge galatasaray".split()
POSN={1:"Goleiro",2:"Zagueiro",3:"Zagueiro",4:"Lateral-esquerdo",5:"Lateral-direito",6:"Volante",7:"Meio-campo",8:"Meio-campo",9:"Meio-campo",10:"Meia-atacante",11:"Ponta-esquerda",12:"Ponta-direita",13:"Atacante",14:"Atacante"}
NAT=d['N']
def natpos(p):
  ps=POS.get(str(p[0])); return [NAT[p[2]][0] if p[2] is not None and p[2]<len(NAT) else "", POSN.get(ps[1],"") if ps and len(ps)>1 else ""]
PICK={"Adriano":5876,"Fred":31005,"Alex":18537}
MANUAL={"Alfredo Di Stéfano":["Argentina","Atacante"],"Carlos Alberto Torres":["Brasil","Lateral-direito"],"Ferenc Puskás":["Hungria","Atacante"],"Garrincha":["Brasil","Ponta-direita"],"Gerd Müller":["Alemanha","Atacante"],"Gérson":["Brasil","Meio-campo"],"Jairzinho":["Brasil","Ponta-direita"],"Just Fontaine":["França","Atacante"],"Nilton Santos":["Brasil","Lateral-esquerdo"],"Pelé":["Brasil","Atacante"],"Rivellino":["Brasil","Meia-atacante"],"Tostão":["Brasil","Atacante"],"Vavá":["Brasil","Atacante"],"Zagallo":["Brasil","Ponta-esquerda"]}
crests=set();themes={};photos={}
def cname(s): return K[s][1]
SLOTS=[("GK",{1},1),("RD",{5},1),("ZAG",{2,3},2),("LE",{4},1),("MEIO",{6,7,8,9,10},3),("ATA",{11,12,13,14},3)]
def val(p): return AT.get(str(p[0])) or (POS.get(str(p[0])) or [0])[0]*0.3
XI_FULL=[True]
def xi(ps):
  XI_FULL[0]=True
  ps=sorted(ps,key=lambda p:-val(p));used=set();out=[]
  pos=lambda p:(POS.get(str(p[0])) or [0,0])
  for nm,codes,n in SLOTS:
    c=[p for p in ps if p[0] not in used and len(pos(p))>1 and pos(p)[1] in codes][:n]
    if len(c)<n: c+= [p for p in ps if p[0] not in used and p not in c and len(pos(p))>2 and set(pos(p)[2:])&codes][:n-len(c)]
    if len(c)<n: XI_FULL[0]=False
    for p in c: used.add(p[0]);out.append(p)
  for p in ps:
    if len(out)>=11: break
    if p[0] not in used and pos(p)[1:2]!=[1]: used.add(p[0]);out.append(p)
  return out
def players(slugs,mainOnly,filt=None,cap=None):
  items=[];ph={}
  for s in slugs:
    idx=set(cidx(s)[:1])
    ps=[p for p in P if p[4] in idx and p[5]>=(2025 if mainOnly else 2026) and str(p[0]) in F]
    ps=xi(ps)
    pp=lambda p:(POS.get(str(p[0])) or [0,0])
    if not XI_FULL[0] or any(not natpos(p)[1] for p in ps): print('INCOMPLETO',s,len(ps)); continue
    for p in ps:
      items.append(["p"+str(p[0]),p[1],s,cname(s)]+natpos(p));ph["p"+str(p[0])]=F[str(p[0])];crests.add(s)
  return items,ph
# --- Brasileirão: elencos e escalação do The Manager (gloria-eterna-astro) ---
TM=os.path.expanduser('~/Downloads/gloria-eterna-astro/src/game/data/')
MT={**json.load(open(TM+'teams.json'))['teams'],**json.load(open(TM+'serieA_extra_teams.json')),**json.load(open(TM+'prelib.json'))['teams']}
FACES=json.load(open(TM+'faces.json'))
TMNAME={"flamengo":"Flamengo","palmeiras":"Palmeiras","sao-paulo":"São Paulo","santos":"Santos","corinthians":"Corinthians","gremio":"Grêmio","internacional":"Internacional","fluminense":"Fluminense","vasco":"Vasco da Gama","cruzeiro":"Cruzeiro","atletico-mg":"Atlético Mineiro","bahia":"Bahia","botafogo":"Botafogo","athletico-pr":"Athletico Paranaense"}
GRP={"GK":"GK","CB":"DEF","LB":"DEF","RB":"DEF","DMF":"MID","CM":"MID","AM":"MID","LM":"MID","RM":"MID","LW":"ATT","RW":"ATT","SS":"ATT","ST":"ATT"}
PTN={"GK":"Goleiro","CB":"Zagueiro","LB":"Lateral-esquerdo","RB":"Lateral-direito","DMF":"Volante","CM":"Meio-campo","AM":"Meia-atacante","LM":"Meia-esquerda","RM":"Meia-direita","LW":"Ponta-esquerda","RW":"Ponta-direita","SS":"Segundo atacante","ST":"Atacante"}
F433=["GK","LB","CB","CB","RB","DMF","CM","AM","LW","ST","RW"]
byname={}
for p in P: byname.setdefault(p[1],[]).append(p)
import base64
FDIR=os.path.expanduser('~/Downloads/gloria-eterna-astro/public/images/faces/')
for fn in os.listdir(FDIR):
  tmid,ext=os.path.splitext(fn)
  if tmid not in F and ext in ('.webp','.jpg'):
    F[tmid]='data:image/%s;base64,'%('webp' if ext=='.webp' else 'jpeg')+base64.b64encode(open(FDIR+fn,'rb').read()).decode()
def tmPhoto(pl):
  tm=FACES.get(str(pl['id']))
  if tm and str(tm) in F: return str(tm)
  c=[p for p in byname.get(pl['name'],[]) if str(p[0]) in F and p[5]>=2024]
  return str(c[0][0]) if len(c)==1 else None
def eff(p,slot):
  m=1 if p['pos']==slot else .93 if slot in (p.get('altPos') or []) else .85 if GRP[p['pos']]==GRP[slot] else .68
  return p['ovr']*m
it=[];ph={};NOPH=[]
for slug,tn in TMNAME.items():
  pool=[p for p in MT[tn]['players'] if not p.get('injured') and not p.get('suspended')]
  withph=[p for p in pool if tmPhoto(p)]
  for p in pool:
    if not tmPhoto(p): NOPH.append((tn,p['name'],p['ovr']))
  used=set()
  for slot in F433:
    b=max((p for p in withph if p['id'] not in used),key=lambda p:eff(p,slot))
    used.add(b['id']);tm=tmPhoto(b)
    it.append(["p"+tm,b['name'],slug,cname(slug),b['nat'],PTN[b['pos']]]);ph["p"+tm]=F[tm];crests.add(slug)
BR_SWAP={("Flamengo","Nicolás De La Cruz"):"Giorgian De Arrascaeta"}
for (tn,out),inn in BR_SWAP.items():
  slug=[k for k,v in TMNAME.items() if v==tn][0]
  pl=[p for p in MT[tn]['players'] if p['name']==inn][0];tm=tmPhoto(pl);assert tm,inn
  i=[j for j,x in enumerate(it) if x[2]==slug and x[1]==out][0]
  del ph[it[i][0]]
  it[i]=["p"+tm,pl['name'],slug,cname(slug),pl['nat'],PTN[pl['pos']]];ph["p"+tm]=F[tm]
themes['jbr']={'n':'Jogadores do Futebol Brasileiro','k':'p','items':it};photos['jbr']=ph
json.dump(NOPH,open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'sem_foto.json'),'w'),ensure_ascii=False)
it,ph=players(CL,False,lambda p:(AT.get(str(p[0])) or 0)>=12000000 or p[6]==1,14);CL_DROP={"brugge","ajax","psv","atalanta","tottenham"}
CL_KEEP={"galatasaray":["Victor Osimhen"],"benfica":["Anatoliy Trubin","Richard Ríos","Vangelis Pavlidis"],"sporting":["Pedro Gonçalves"],
 "monaco":["Vanderson","Denis Zakaria","Maghnes Akliouche","Folarin Balogun","Ansu Fati"],"marseille":["Igor Paixão"],"leverkusen":["Exequiel Palacios"]}
CL_REMOVE={"dortmund":["Joane Gadou","Carney Chukwuemeka","Maximilian Beier"],"bayern":["Jonas Urbig"],"juventus":["Zeki Çelik","Andrea Cambiaso"],
 "napoli":["Sam Beukema","Miguel Gutiérrez","Billy Gilmour","Antonio Vergara"]}
CL_MOVE={"Karim Adeyemi":"barcelona"}
CL_ADD={"bayern":["Manuel Neuer","Joshua Kimmich"]}
names={i[1] for i in it}
for d in (CL_KEEP,CL_REMOVE):
  for c,ns in d.items():
    for n in ns: assert any(i[1]==n and i[2]==c for i in it),('nao achei',c,n)
it=[i for i in it if i[2] not in CL_DROP and (i[2] not in CL_KEEP or i[1] in CL_KEEP[i[2]]) and i[1] not in CL_REMOVE.get(i[2],[])]
for i in it:
  if i[1] in CL_MOVE: i[2]=CL_MOVE[i[1]]; i[3]=cname(i[2])
for c,ns in CL_ADD.items():
  for n in ns:
    ps=[p for p in P if p[1]==n and str(p[0]) in F]; assert len(ps)==1,(n,len(ps)); p=ps[0]
    it.append(["p"+str(p[0]),p[1],c,cname(c)]+natpos(p)); ph["p"+str(p[0])]=F[str(p[0])]
ph={i[0]:ph[i[0]] for i in it}
themes['jcl']={'n':'Jogadores da Champions League','k':'p','items':it};photos['jcl']=ph
themes['tbr']={'n':'Times Brasileiros','k':'t','items':[[s,cname(s),s,'Série A'] for s in BRT]+[[s,cname(s),s,'Série B'] for s in SERIEB]};crests.update(BRT+SERIEB)
themes['teu']={'n':'Times da Europa','k':'t','items':[[s,cname(s),s,K[s][4]] for s in EUT]};crests.update(EUT)
LEG=json.load(open(os.path.join(os.path.dirname(__file__),'lendas.json')))
byn={}
for p in P: byn.setdefault(p[1],[]).append(p)
it=[];ph={}
for n,s in LEG.items():
  if n in L: key="l"+str(len(it)); img=L[n]; np=MANUAL[n]
  else:
    ps=sorted([p for p in byn.get(n,[]) if str(p[0]) in F],key=lambda p:-p[6])
    if n in PICK: ps=[p for p in byn[n] if p[0]==PICK[n]]
    p=ps[0]; key="p"+str(p[0]); img=F[str(p[0])]; np=natpos(p)
  if s not in K: print('no crest',n,s); continue
  it.append([key,n,s,cname(s)]+np);ph[key]=img;crests.add(s)
themes['len']={'n':'Lendas do Futebol','k':'p','items':it};photos['len']=ph
for s in crests: assert s in E, s
json.dump({'themes':themes},open(OUT+'/temas.json','w'),ensure_ascii=False,separators=(',',':'))
json.dump({s:E[s] for s in sorted(crests)},open(OUT+'/escudos.json','w'),separators=(',',':'))
for t,ph in photos.items(): json.dump(ph,open(OUT+f'/fotos-{t}.json','w'),separators=(',',':'))
for t,v in themes.items(): print(t,len(v['items']))
