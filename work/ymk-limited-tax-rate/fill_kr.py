from hwplib import Hwp, YELLOW
SRC="/root/.claude/uploads/174f59fa-52c3-5e06-abd5-91427a2ae67d/f85ece1c-____72__2__________________________________.hwp"
DST="YMK_제한세율적용신청서_기입본(이자·배당).hwp"
Y={'shade':YELLOW}; YS={'shade':YELLOW,'size':800}; S={'size':800}
d=Hwp(SRC)

def val(label,text,spans=None):
    P=d.paras(); h=d.find(label); v=P[P.index(h)+1]
    d.set(v,text)
    if spans: d.style(d.idx_of(d.body[v]) if False else v, spans)

# 접수란 — YMK가 수령 시 기재
val('접수번호','수령 시 기재',[('수령 시 기재',Y)])
val('접수일자','수령일 기재',[('수령일 기재',Y)])

# ① 유형
d.sub(d.find('[  ] 법인,'),'[  ] 법인','[√ ] 법인')

# ②~⑨
val('② 법인명','Yodogawa Hu-Tech Co., Ltd.',[('Yodogawa Hu-Tech Co., Ltd.',S)])
val('⑥ 주소','2-4-8 Esaka-cho, Suita-shi, Osaka 〒_______ JAPAN',
    [('2-4-8 Esaka-cho, Suita-shi, Osaka ',S),('〒_______',YS),(' JAPAN',S)])
val('③ 대표자 성명','여권상 영문 성명',[('여권상 영문 성명',Y)])
val('⑦ 거주지국','JAPAN')
val('④ 납세자번호','法人番号 13자리',[('法人番号 13자리',Y)])
val('⑧ 국가코드','JP')
val('⑤ 설립 연월일','1964-07-07')
val('⑨ 전화번호','+81-6-____-____',[('+81-6-____-____',Y)])

# ⑩ 이자 + 배당
h=d.find('⑩ 대한민국과'); l1,l2,l3=d.text(h)[:-1].split('\n')
l1=(l1.replace('대한민국과           간의','대한민국과   일본국     간의',1)
      .replace('제    조','제 11 조',1).replace('제    항','제 2  항',1)
      .replace('        소득','   이자   소득',1).replace('세율     %','세율  10 %',1))
l2=(l2.replace('제    조','제 10 조',1).replace('제    항','제 2  항',1)
      .replace('제    호','제 가  호',1)
      .replace('        소득','   배당   소득',1).replace('세율     %','세율  5  %',1))
d.set(h,'\n'.join([l1,l2,l3]))

# ⑪~⑯
start=d.find('3. 실질귀속자 판정기준')
for key in ('등에 준하는 체약상대국','비영리단체로서 수익을 구성원에게',
            '조세조약에 따라 그 설립된 국가에서 납세의무를 부담하는 자에 해당하고',
            '에 해당하지 않는 국외투자기구가','조세조약상 혜택을 배제(제한)시키는'):
    d.sub(d.find(key,start=start),'아니오 [  ]','아니오 [√ ]')
d.sub(d.find('지급받는 국내원천소득의 실질귀속자입니까'),'예 [  ]','예 [√ ]')

# 서명
h=d.find(' 년        월        일'); d.set(h,'2026 년       월       일')
d.style(h,[('2026 년       월       일',Y)])
h=d.find('신 청 인(대표자)')
d.set(h,'신 청 인(대표자)  Yodogawa Hu-Tech Co., Ltd.  대표자 영문 성명')
d.style(h,[('  Yodogawa Hu-Tech Co., Ltd.  ',S),('대표자 영문 성명',YS)])
d.set(d.find('귀하'),'주식회사 와이엠케이   귀하')

# 대리인
d.sub(d.find('[  ]납세관리인'),'[  ]그 외','[√ ]그 외')
for needle,suffix in (('성명 또는 법인명','  이준호 (세무대리인·공인회계사)'),
                      ('사업자(주민)등록번호','  144-86-03413 / 02-2183-1367'),
                      ('주소 또는 소재지','  서울 강남구 테헤란로70길12, 6층(H타워)')):
    h=d.find(needle); d.append(h,suffix); d.style(h,[(suffix,S)])

# 뒤쪽
back=d.find('제98조의6제4항')
P=d.paras(); anchor=P.index(d.find('주소 또는 소재지',start=back))
targets=[d.body[P[anchor+1+k]] for k in range(5)]
for obj,v in zip(targets,['주식회사 와이엠케이','OGAWA KATSUMI','135-81-42023',
                          '031-8005-8722','경기도 평택시 청북읍 현곡산단로 29']):
    i=d.idx_of(obj); d.set(i,v)
    if len(v)>14: d.style(i,[(v,S)])
h=d.find('제 출 자',start=back)
d.set(h,'제 출 자   주식회사 와이엠케이  대표 OGAWA KATSUMI')
d.style(h,[('   주식회사 와이엠케이  대표 OGAWA KATSUMI',S)])
d.sub(d.find('세무서장 귀하',start=back),'                 세무서장','            평택   세무서장')
h=d.find('                    년        월        일',start=back)
d.set(h,'                2027 년     2 월       일')
d.style(h,[('2027 년     2 월       일',Y)])

print("saved:",d.save(DST),"| 글자모양 변형:",d._var)
