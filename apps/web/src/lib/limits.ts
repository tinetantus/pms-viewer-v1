import { database } from '../../../../packages/db';
import { requireThat } from '../../../../packages/domain';
export async function rateLimit(key: string, limit: number, seconds = 60) {
  const result = await database().query(
    `INSERT INTO request_limit(key,count,expires_at) VALUES($1,1,now()+make_interval(secs=>$2))
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limit.expires_at<now() THEN 1 ELSE request_limit.count+1 END,
    expires_at=CASE WHEN request_limit.expires_at<now() THEN now()+make_interval(secs=>$2) ELSE request_limit.expires_at END RETURNING count`,
    [key, seconds],
  );
  requireThat(
    result.rows[0].count <= limit,
    429,
    'Too many requests. Please wait a minute and try again.',
  );
}
