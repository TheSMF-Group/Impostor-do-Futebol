import sys,os
SP=sys.argv[1];s=open(SP+'/build/src.html').read()
tags=''
for id,f in [('d-temas','temas.json'),('d-escudos','escudos.json'),('d-fotos-jbr','fotos-jbr.json'),('d-fotos-jcl','fotos-jcl.json'),('d-fotos-len','fotos-len.json')]:
  t=open(SP+'/data/'+f).read(); assert '</' not in t
  tags+=f'<script type="application/json" id="{id}">{t}</script>\n'
i=s.index('<script>\n/* Temas')
import base64
import re
s=re.sub(r'__ARTE_([A-Z]+)__',lambda m:'data:image/webp;base64,'+base64.b64encode(open(SP+'/build/arte_'+m.group(1)+'.webp','rb').read()).decode(),s)
i=s.index('<script>\n/* Temas')
open(SP+'/impostor-do-futebol.html','w').write(s[:i]+tags+s[i:])
print(os.path.getsize(SP+'/impostor-do-futebol.html'))
