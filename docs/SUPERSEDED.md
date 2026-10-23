# 이전 작업 폴더 안내

`C:\git\Bit-O\ticket-build`와 `C:\git\Bit-O\ticket-macro-build`는 이 `ticket` 폴더로 통합되어 더 이상 사용하지 않는다. 사용자가 확인 후 삭제한다.

- `ticket-build` (0.2.0, 오픈 예약 도우미 전용): runToken, 준비 알림, 수정/복제/재시작, 백업 저장·불러오기, 전체 중지, planKey 중복 판정, validatePlan 보강을 `ticket` 0.4.0에 병합했다. 그 폴더의 `background.js`는 매크로 엔진 등록(`registerMacroEngine()`)과 `MACRO_` 메시지 전달이 없으므로 통째로 복사하면 안 된다.
- `ticket-macro-build` (0.2.0 매크로): `ticket` 0.3.0(취소표 대기 포함)의 이전 버전이다. 고유한 변경은 없다.
- 두 폴더의 `test-results/*.png`는 오래된 스크린샷이다.
