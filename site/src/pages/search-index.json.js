// 검색 색인을 정적 JSON 파일로 뽑는다.
// 모든 페이지에 인라인으로 심으면 차시 페이지가 140KB까지 커진다.
// 검색 페이지만 이 파일을 가져오면 되고, 정적 파일이므로 오프라인에서도 동작한다.
import { searchIndex } from '../lib/content.js';

export function GET() {
  return new Response(JSON.stringify(searchIndex()), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
