/**
 * The storage layout for Lecture_Material bytes, shared by every target.
 *
 * `sessions/<sessionId>/material/v<version>/<uuid>.<ext>` — an S3 object key on
 * the AWS target and a path under `.classmind/materials/` everywhere else.
 *
 * The material version sits in the key, so replacing a Lecture_Material is a
 * write to a new prefix followed by a delete of the old one — never an in-place
 * overwrite, so a failed replacement cannot corrupt a working demo.
 *
 * Pure and SDK-free, so the local target can lay files out the same way
 * without loading the AWS SDK.
 */

export function materialObjectKey(
  sessionId: string,
  version: number,
  objectId: string,
  ext: string,
): string {
  return `${materialVersionPrefix(sessionId, version)}${objectId}.${ext}`;
}

/** The prefix a material-version purge deletes. */
export function materialVersionPrefix(sessionId: string, version: number): string {
  return `sessions/${sessionId}/material/v${version}/`;
}

/** The prefix owning every object of one Class_Session. */
export function sessionObjectPrefix(sessionId: string): string {
  return `sessions/${sessionId}/`;
}
