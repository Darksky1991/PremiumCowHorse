import { z } from 'zod'
import { LAUNCH_MODES, type LaunchCapabilities } from '@pch/shared'
import type { Database } from '../../infra/db/client'

const capabilitiesSchema = z.strictObject({
  ext: z.string(),
  appName: z.string().nullable(),
  options: z.array(
    z.strictObject({
      mode: z.enum(LAUNCH_MODES),
      via: z.discriminatedUnion('type', [
        z.strictObject({ type: z.literal('verb'), verb: z.string() }),
        z.strictObject({ type: z.literal('switch'), exe: z.string(), args: z.array(z.string()) })
      ])
    })
  )
}) satisfies z.ZodType<LaunchCapabilities>

/**
 * 打开方式检测结果的持久化（只做存取）。结构不符的行视为没有保存（调用方重新检测）。
 * 按机器区分：数据库可能随漫游配置文件到别的机器，只读写 / 清除 `machine`（本机标识）的行
 */
export class LaunchCapabilitiesRepo {
  constructor(
    private readonly db: Database,
    private readonly machine: string
  ) {}

  async get(ext: string): Promise<LaunchCapabilities | undefined> {
    const row = await this.db
      .selectFrom('launch_capabilities')
      .select('data')
      .where('machine', '=', this.machine)
      .where('ext', '=', ext)
      .executeTakeFirst()
    if (!row) return undefined
    try {
      const parsed = capabilitiesSchema.safeParse(JSON.parse(row.data))
      return parsed.success && parsed.data.ext === ext ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  async put(caps: LaunchCapabilities): Promise<void> {
    const data = JSON.stringify(caps)
    const detectedAt = Date.now()
    await this.db
      .insertInto('launch_capabilities')
      .values({ machine: this.machine, ext: caps.ext, data, detected_at: detectedAt })
      .onConflict((oc) =>
        oc.columns(['machine', 'ext']).doUpdateSet({ data, detected_at: detectedAt })
      )
      .execute()
  }

  /** 只清除本机的行（其他机器的结果属于那台机器） */
  async clear(): Promise<void> {
    await this.db.deleteFrom('launch_capabilities').where('machine', '=', this.machine).execute()
  }
}
