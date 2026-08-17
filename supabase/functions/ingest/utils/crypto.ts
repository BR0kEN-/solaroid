export class Hash {
  public readonly bytes!: Uint8Array<ArrayBuffer>

  protected constructor(protected readonly value: ArrayBuffer) {
    this.bytes = new Uint8Array(this.value)
  }

  static async fromBuffer(value: BufferSource) {
    return new Hash(await crypto.subtle.digest('SHA-256', value))
  }

  static fromString(value: string) {
    return this.fromBuffer(new TextEncoder().encode(value))
  }

  static async eq(left: string, right: string) {
    const [l, r] = await Promise.all([
      this.fromString(left),
      this.fromString(right),
    ])

    return l.eq(r)
  }

  eq(hash: this): boolean {
    let difference = 0

    for (let index = 0; index < this.bytes.length; index += 1) {
      difference |= this.bytes[index] ^ hash.bytes[index]
    }

    return difference === 0
  }

  toHexString(): string {
    return [...this.bytes]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }
}

export async function hash(value: string): Promise<string> {
  return (await Hash.fromString(value)).toHexString()
}
