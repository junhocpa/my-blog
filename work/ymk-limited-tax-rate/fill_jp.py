import json
from hwplib import Hwp, YELLOW
SRC="/root/.claude/uploads/174f59fa-52c3-5e06-abd5-91427a2ae67d/f85ece1c-____72__2__________________________________.hwp"
DST="YMK_制限税率適用申込書_参考訳(日本語).hwp"
Y={'shade':YELLOW}; YS={'shade':YELLOW,'size':800}; S={'size':800}
jp=json.load(open('jp_map.json'))
d=Hwp(SRC)

# 1) 채울 문단을 한국어 기준으로 먼저 포착
P=d.paras()
def vrec(label):
    h=d.find(label); return d.body[P[P.index(h)+1]]
T={'접수번호_v':vrec('접수번호'),'접수일자_v':vrec('접수일자'),
   '유형':d.body[d.find('[  ] 법인,')],'⑩':d.body[d.find('⑩ 대한민국과')],
   '표제':d.body[d.find('[별지 제72호의2서식]')]}
for lab in ('② 법인명','⑥ 주소','③ 대표자 성명','⑦ 거주지국','④ 납세자번호',
            '⑧ 국가코드','⑤ 설립 연월일','⑨ 전화번호'): T[lab]=vrec(lab)
start=d.find('3. 실질귀속자 판정기준')
for n,key in enumerate(('등에 준하는 체약상대국','비영리단체로서 수익을 구성원에게',
                        '조세조약에 따라 그 설립된 국가에서 납세의무를 부담하는 자에 해당하고',
                        '에 해당하지 않는 국외투자기구가','조세조약상 혜택을 배제(제한)시키는')):
    T[f'no{n}']=d.body[d.find(key,start=start)]
T['yes']=d.body[d.find('지급받는 국내원천소득의 실질귀속자입니까')]
T['날짜']=d.body[d.find(' 년        월        일')]
T['신청인']=d.body[d.find('신 청 인(대표자)')]; T['귀하']=d.body[d.find('귀하')]
T['대리유형']=d.body[d.find('[  ]납세관리인')]
T['⑱']=d.body[d.find('성명 또는 법인명')]; T['⑲']=d.body[d.find('사업자(주민)등록번호')]
T['⑳']=d.body[d.find('주소 또는 소재지')]
back=d.find('제98조의6제4항')
P=d.paras(); anchor=P.index(d.find('주소 또는 소재지',start=back))
for k in range(5): T[f'b{k}']=d.body[P[anchor+1+k]]
T['제출자']=d.body[d.find('제 출 자',start=back)]
T['세무서']=d.body[d.find('세무서장 귀하',start=back)]
T['뒤날짜']=d.body[d.find('                    년        월        일',start=back)]

# 2) 전체 일본어 치환
n=0
for h in d.paras():
    t=d.text(h)
    if t and t.rstrip('\r') in jp: d.set(h, jp[t.rstrip('\r')]); n+=1
print("translated:",n)
def I(k): return d.idx_of(T[k])

# 3) 기입
h=I('표제'); d.append(h,'   ※ 参考訳(提出用ではありません)')
d.style(h,[('※ 参考訳(提出用ではありません)',YS)])
h=I('접수번호_v'); d.set(h,'受領時に記載'); d.style(h,[('受領時に記載',Y)])
h=I('접수일자_v'); d.set(h,'受領日を記載'); d.style(h,[('受領日を記載',Y)])
d.sub(I('유형'),'[  ] 法人','[√ ] 法人')

h=I('② 법인명'); d.set(h,'Yodogawa Hu-Tech Co., Ltd.'); d.style(h,[('Yodogawa Hu-Tech Co., Ltd.',S)])
h=I('⑥ 주소');  d.set(h,'2-4-8 Esaka-cho, Suita-shi, Osaka 〒_______ JAPAN')
d.style(h,[('2-4-8 Esaka-cho, Suita-shi, Osaka ',S),('〒_______',YS),(' JAPAN',S)])
h=I('③ 대표자 성명'); d.set(h,'パスポート上の英文氏名'); d.style(h,[('パスポート上の英文氏名',Y)])
d.set(I('⑦ 거주지국'),'JAPAN')
h=I('④ 납세자번호'); d.set(h,'法人番号 13桁'); d.style(h,[('法人番号 13桁',Y)])
d.set(I('⑧ 국가코드'),'JP'); d.set(I('⑤ 설립 연월일'),'1964-07-07')
h=I('⑨ 전화번호'); d.set(h,'+81-6-____-____'); d.style(h,[('+81-6-____-____',Y)])

h=I('⑩'); l1,l2,l3=d.text(h)[:-1].split('\n')
l1=(l1.replace('大韓民国と           間の','大韓民国と   日本国     間の',1)
      .replace('第    条','第 11 条',1).replace('第    項','第 2  項',1)
      .replace('        所得','   利子   所得',1).replace('税率     %','税率  10 %',1))
l2=(l2.replace('第    条','第 10 条',1).replace('第    項','第 2  項',1)
      .replace('第    号','第 イ  号',1)
      .replace('        所得','   配当   所得',1).replace('税率     %','税率  5  %',1))
d.set(h,'\n'.join([l1,l2,l3]))

for k in range(5): d.sub(I(f'no{k}'),'いいえ [  ]','いいえ [√ ]')
d.sub(I('yes'),'はい [  ]','はい [√ ]')

h=I('날짜'); d.set(h,'2026 年       月       日'); d.style(h,[('2026 年       月       日',Y)])
h=I('신청인'); d.set(h,'申 込 人(代表者)  Yodogawa Hu-Tech Co., Ltd.  代表者英文氏名')
d.style(h,[('  Yodogawa Hu-Tech Co., Ltd.  ',S),('代表者英文氏名',YS)])
d.set(I('귀하'),'株式会社ワイエムケイ(YMK)   貴下')

d.sub(I('대리유형'),'[  ]その他代理人','[√ ]その他代理人')
for key,suffix in (('⑱','  イ・ジュンホ (税務代理人・公認会計士)'),
                   ('⑲','  144-86-03413 / 02-2183-1367'),
                   ('⑳','  ソウル市江南区テヘラン路70キル12, 6階(Hタワー)')):
    h=I(key); d.append(h,suffix); d.style(h,[(suffix,S)])

for k,v in enumerate(['株式会社ワイエムケイ(YMK)','OGAWA KATSUMI','135-81-42023',
                      '031-8005-8722','京畿道平沢市青北邑玄谷産団路29']):
    h=I(f'b{k}'); d.set(h,v)
    if len(v)>13: d.style(h,[(v,S)])
h=I('제출자'); d.set(h,'提 出 者   株式会社ワイエムケイ(YMK)  代表 OGAWA KATSUMI')
d.style(h,[('   株式会社ワイエムケイ(YMK)  代表 OGAWA KATSUMI',S)])
d.sub(I('세무서'),'                 税務署長','            平沢   税務署長')
h=I('뒤날짜'); d.set(h,'                2027 年     2 月       日')
d.style(h,[('2027 年     2 月       日',Y)])

print("saved:",d.save(DST))
