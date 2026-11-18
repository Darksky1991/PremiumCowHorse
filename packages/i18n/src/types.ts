import type ja from './locales/ja'

/** 以日语资源为基准：其他语言必须拥有完全相同的键（缺键、多键都会编译失败） */
type DeepStringRecord<T> = { [K in keyof T]: T[K] extends string ? string : DeepStringRecord<T[K]> }
export type Resource = DeepStringRecord<typeof ja>
export type Namespace = keyof Resource
