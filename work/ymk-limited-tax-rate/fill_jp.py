import json
from hwplib import Hwp
SRC="/root/.claude/uploads/174f59fa-52c3-5e06-abd5-91427a2ae67d/f85ece1c-____72__2__________________________________.hwp"
DST="YMK_制限税率適用申込書_参考訳(日本語).hwp"
jp=json.load(open('jp_map.json'))
d=Hwp(SRC)

# ---- 1) 채울 문단을 한국어 기준으로 먼저 포착(레코드 객체로 고정) ----
def rec(korean_needle):
    return d.body[d.find(korean_needle)]
P=d.paras()
def value_of(label):
    h=d.find(label); return d.body[P[P.index(h)+1]]
P=d.paras()
T={}
T['접수번호_v']=value_of('접수번호'); T['접수일자_v']=value_of('접수일자')
T['유형']=rec('[  ] 법인,')
for lab in ('② 법인명','⑥ 주소','③ 대표자 성명','⑦ 거주지국','④ 납세자번호',
            '⑧ 국가코드','⑤ 설립 연월일','⑨ 전화번호'):
    T[lab]=value_of(lab)
T['⑩']=rec('⑩ 대한민국과')
start=d.find('3. 실질귀속자 판정기준')
for n,key in enumerate(('등에 준하는 체약상대국','비영리단체로서 수익을 구성원에게',
                        '조세조약에 따라 그 설립된 국가에서 납세의무를 부담하는 자에 해당하고',
                        '에 해당하지 않는 국외투자기구가','조세조약상 혜택을 배제(제한)시키는')):
    T[f'no{n}']=rec_=d.body[d.find(key,start=start)]
T['yes']=rec('지급받는 국내원천소득의 실질귀속자입니까')
T['날짜']=rec(' 년        월        일')
T['신청인']=rec('신 청 인(대표자)'); T['귀하']=rec('귀하')
T['대리유형']=rec('[  ]납세관리인')
T['⑱']=rec('성명 또는 법인명'); T['⑲']=rec('사업자(주민)등록번호'); T['⑳']=rec('주소 또는 소재지')
back=d.find('제98조의6제4항')
P=d.paras(); anchor=P.index(d.find('주소 또는 소재지',start=back))
for k in range(5): T[f'b{k}']=d.body[P[anchor+1+k]]
T['제출자']=d.body[d.find('제 출 자',start=back)]
T['세무서']=d.body[d.find('세무서장 귀하',start=back)]
T['뒤날짜']=d.body[d.find('                    년        월        일',start=back)]
T['표제']=rec('[별지 제72호의2서식]')

# ---- 2) 전체 문단 일본어로 치환 (레코드 삽입 없음 → 객체 유효) ----
n=0
for h in d.paras():
    t=d.text(h)
    if not t: continue
    k=t.rstrip('\r')
    if k in jp: d.set(h, jp[k]); n+=1
print("translated paragraphs:",n)

def I(key): return d.idx_of(T[key])

# ---- 3) 일본어 기준으로 기입 ----
d.append(I('표제'),'   ※ 参考訳(提出用ではありません)',marks=['※ 参考訳(提出用ではありません)'])
d.set(I('접수번호_v'),'★ YMK 受領時の一連番号',marks=['★ YMK 受領時の一連番号'])
d.set(I('접수일자_v'),'★ YMK 受領日',marks=['★ YMK 受領日'])
d.sub(I('유형'),'[  ] 法人','[√ ] 法人')

vals={'② 법인명'    :('Yodogawa Hu-Tech Co., Ltd.',[]),
      '⑥ 주소'      :('2-4-8, Esaka-cho, Suita-shi, Osaka, ★〒_______, Japan',['★〒_______']),
      '③ 대표자 성명':('★ パスポート上の英文氏名(全部)',['★ パスポート上の英文氏名(全部)']),
      '⑦ 거주지국'   :('JAPAN',[]),
      '④ 납세자번호' :('★ 日本 法人番号 13桁 (無い場合はLEI)',['★ 日本 法人番号 13桁 (無い場合はLEI)']),
      '⑧ 국가코드'   :('JP',[]),
      '⑤ 설립 연월일':('1964-07-07',[]),
      '⑨ 전화번호'   :('★ +81-6-____-____',['★ +81-6-____-____'])}
for lab,(v,m) in vals.items(): d.set(I(lab),v,m)

h=I('⑩'); l1,l2,l3=d.text(h)[:-1].split('\n')
l1=(l1.replace('大韓民国と           間の','大韓民国と   日本国     間の',1)
      .replace('第    条','第 11 条',1).replace('第    項','第 2  項',1)
      .replace('        所得','   利子   所得',1).replace('税率     %','税率  10 %',1))
l2=(l2.replace('第    条','第 10 条',1).replace('第    項','第 2  項',1)
      .replace('第    号','第 イ  号',1)
      .replace('        所得','   配当   所得',1).replace('税率     %','税率  5  %',1))
d.set(h,'\n'.join([l1,l2,l3]))

for n_ in range(5): d.sub(I(f'no{n_}'),'いいえ [  ]','いいえ [√ ]')
d.sub(I('yes'),'はい [  ]','はい [√ ]')

d.set(I('날짜'),'★ 2026 年   ★ 月   ★ 日',marks=['★ 2026 年   ★ 月   ★ 日'])
d.set(I('신청인'),'申 込 人(代表者)   Yodogawa Hu-Tech Co., Ltd.   ★代表者英文氏名',
      marks=['★代表者英文氏名'])
d.set(I('귀하'),'株式会社ワイエムケイ(YMK)   貴下')

d.sub(I('대리유형'),'[  ]その他代理人','[√ ]その他代理人')
d.append(I('⑱'),'   イ・ジュンホ (税務代理人・公認会計士)')
d.append(I('⑲'),'   144-86-03413   /   連絡先 02-2183-1367')
d.append(I('⑳'),'   ソウル市江南区テヘラン路70キル12, 6階(Hタワー, 大峙洞)')

for k,v in enumerate(['株式会社ワイエムケイ(YMK)','OGAWA KATSUMI','135-81-42023',
                      '031-8005-8722','京畿道平沢市青北邑玄谷産団路29']):
    d.set(I(f'b{k}'),v)
d.set(I('제출자'),'提 出 者    株式会社ワイエムケイ(YMK)  代表 OGAWA KATSUMI')
d.sub(I('세무서'),'                 税務署長','            平沢   税務署長')
d.set(I('뒤날짜'),'                 ★ 2027 年   ★ 2 月   ★ 日',marks=['★ 2027 年   ★ 2 月   ★ 日'])

print("saved:",d.save(DST))
