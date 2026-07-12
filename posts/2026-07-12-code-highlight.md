---
title: 코드 하이라이팅 언어별 데모
date: 2026-07-12
description: 자바스크립트, 파이썬, HTML, CSS, JSON, Bash 코드 블록의 하이라이팅 결과를 확인합니다.
tags: [개발, 가이드]
---

이 블로그의 코드 하이라이터는 외부 라이브러리 없이 정규식 기반 토크나이저로 구현되어 있습니다. 언어별 렌더링 결과를 확인해 봅니다.

## JavaScript

```js
// 피보나치 수열
async function fib(n) {
  if (n <= 1) return n;
  let [a, b] = [0, 1];
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}

const result = await fib(10);
console.log(`fib(10) = ${result}`); // 55
```

## Python

```python
# 소수 판별
def is_prime(n: int) -> bool:
    """n이 소수인지 확인한다."""
    if n < 2:
        return False
    for i in range(2, int(n ** 0.5) + 1):
        if n % i == 0:
            return False
    return True

primes = [n for n in range(50) if is_prime(n)]
print(primes)
```

## HTML

```html
<!-- 시맨틱 마크업 예시 -->
<article class="post">
  <h1>글 제목</h1>
  <time datetime="2026-07-12">2026년 7월 12일</time>
  <p>본문 내용</p>
</article>
```

## CSS

```css
/* 다크 모드 변수 */
[data-theme="dark"] {
  --bg: #101318;
  --text: #e4e7eb;
}

.post-content pre {
  padding: 1rem;
  border-radius: 8px;
  overflow-x: auto;
}
```

## JSON

```json
{
  "title": "코드 하이라이팅 데모",
  "date": "2026-07-12",
  "published": true,
  "views": 128,
  "tags": ["개발", "가이드"]
}
```

## Bash

```bash
# 블로그 빌드 후 결과 확인
node build.js
ls dist/posts
echo "빌드 완료: $BLOG_DIR"
```

지원하지 않는 언어는 하이라이팅 없이 일반 텍스트로 표시됩니다.
