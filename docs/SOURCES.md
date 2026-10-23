# 예매처 확인 기록

확인일: 2026-10-06. 예매 시각·수량 제한·좌석 가격은 하드코딩하지 않는다.

| 홈 구단 | 예매처 | 기본 연결 |
|---|---|---|
| LG·한화·삼성·KT·KIA | 티켓링크 | https://www.ticketlink.co.kr/sports/baseball |
| 두산 | NOL 티켓 | https://nol.yanolja.com/ticket/genre/sports/bears |
| 키움 | NOL 티켓 | https://nol.yanolja.com/ticket/genre/sports/heroes |
| SSG | 구단 전용 | https://ticket.ssg.com/ |
| 롯데 | 구단 전용 | https://ticket.giantsclub.com/ |
| NC | 구단 전용 | https://ticket.ncdinos.com/ |

출처: [KBO 공식 티켓 안내](https://www.koreabaseball.com/kbo/league/map.aspx), [NOL 공식 스포츠 목록](https://nol.yanolja.com/ticket/genre/sports).

KBO에서 위 공식 주소 연결을 확인했다. 두산·키움 구단 경로는 NOL 목록에서 직접 확인했다. 티켓링크는 동적 화면이며, SSG는 본문을 읽지 못했고, 롯데는 조회 시간 초과, NC는 로그인 경로에서 403이었다. 예매처의 실제 로그인 이후 화면·좌석 프레임·결제는 검증하지 않았다.

10개 구단은 예약 및 공식 페이지 열기를 지원한다. 예매 버튼 탐지는 공통 DOM 규칙으로만 동작하며 각 실서비스 DOM에 대한 호환성 보장은 없다. 연도 포함 날짜, 시작 시간, 양 팀 이름이 같은 작은 경기 카드에 있어야 탐지한다. 일치하지 않거나 iframe·canvas 안의 화면은 직접 진행한다. 테스트는 실제 확장 프로그램에 오프라인 가상 예매 화면을 연결하여 수행한다. 실제 예매·좌석 확보·결제는 실행하지 않는다.

## 0.2.0 동작 지정 방식

완성된 구단별 자동 예매 어댑터가 아닌, 사용자 지정 DOM 동작 실행 엔진을 추가했다. 프레임/팝업 추적은 Chrome의 scripting 및 webNavigation API를 사용한다.
- https://developer.chrome.com/docs/extensions/reference/api/scripting
- https://developer.chrome.com/docs/extensions/reference/api/webNavigation

공개 브라우저 조회에서 확인한 티켓링크 경로: LG /sports/137/59, 한화 /sports/137/63, 삼성 /sports/137/57, KIA /sports/137/58. 로그인·좌석 확보·결제는 실행하지 않았다.

## 0.4.0 권한 범위

`*.interpark.com` 전체 대신 NOL 티켓 예매 창에 쓰이는 것으로 알려진 `ticket.interpark.com`, `tickets.interpark.com`, `poticket.interpark.com`만 허용한다. 실서비스로 확인하지 않았다(네트워크 접근 없이 작업). 실제 예매 창이 다른 하위 도메인이면 매크로·감시는 그 프레임에서 동작하지 않고(안전 측), `src/core.js`의 호스트 목록과 manifest를 함께 고쳐야 한다. `nol.yanolja.com`은 하위 도메인 없이 정확히 그 호스트만 허용한다.
