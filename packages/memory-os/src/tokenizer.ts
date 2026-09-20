/**
 * 配套 WordPiece tokenizer —— 由 HuggingFace `tokenizer.json` 驱动
 *
 * 为什么不能自己编：bge-small-zh-v1.5 的 tokenizer.json 里既有词表（21128），
 * 也有 normalizer / pre_tokenizer / post_processor / model 四段完整配置。
 * 必须逐段照着执行，否则 token id 与模型训练时的分词不一致，嵌入向量会整体退化。
 *
 * 本文件实现的正是 tokenizer.json 里声明的流水线：
 *   BertNormalizer(clean_text, handle_chinese_chars, lowercase, strip_accents)
 *     → BertPreTokenizer(按空白切分 + 标点独立成词)
 *     → WordPiece(vocab, unk_token, continuing_subword_prefix, max_input_chars_per_word)
 *     → TemplateProcessing([CLS] A [SEP])
 *
 * 纯 JS，无原生依赖（不变量 #4）。
 */
import fs from 'node:fs';

/** BERT 判定为汉字的 Unicode 区间（取自 tokenization.py 的 _is_chinese_char） */
const CHINESE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0x20000, 0x2a6df],
  [0x2a700, 0x2b73f],
  [0x2b740, 0x2b81f],
  [0x2b820, 0x2ceaf],
  [0xf900, 0xfaff],
  [0x2f800, 0x2fa1f],
];

export function isChineseChar(cp: number): boolean {
  for (const [lo, hi] of CHINESE_RANGES) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

/** 与 Rust char::is_whitespace（Unicode White_Space）对齐；刻意不含 \uFEFF */
const WS_RE = /[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
export function isBertWhitespace(ch: string): boolean {
  return WS_RE.test(ch);
}

const CC_RE = /\p{Cc}/u;
const P_RE = /\p{P}/u;
export function isControl(ch: string): boolean {
  return CC_RE.test(ch);
}

/**
 * BERT 的 is_punctuation：ASCII 标点全范围 + Unicode P* 类。
 * 注意 $ + < = > ^ ` | ~ 属于 ASCII 标点但 Unicode 归为 S*，必须显式覆盖。
 */
export function isPunctuation(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) {
    return true;
  }
  return P_RE.test(ch);
}

export interface BianMaXuanXiang {
  /** 含特殊 token 的最大长度，默认 512 */
  maxLength?: number;
  /** 是否加 [CLS]/[SEP]，默认 true */
  addSpecialTokens?: boolean;
}

export interface Encoded {
  ids: number[];
  attentionMask: number[];
  tokenTypeIds: number[];
  tokens: string[];
}

export interface TokenizerConfigEcho {
  type: string;
  lowercasing: boolean;
  stripAccents: boolean;
  handleChineseChars: boolean;
  cleanText: boolean;
  preTokenizer: string;
  postProcessor: string;
  vocabSize: number;
  unkToken: string;
  continuingSubwordPrefix: string;
  maxInputCharsPerWord: number;
  truncation: unknown;
  padding: unknown;
}

/**
 * tokenizer.json 驱动的 BERT WordPiece 分词器。
 */
export class BertWordPieceFenCiQi {
  readonly vocab: Map<string, number>;
  readonly unkToken: string;
  readonly unkId: number;
  readonly continuingPrefix: string;
  readonly maxInputCharsPerWord: number;
  readonly clsToken = '[CLS]';
  readonly sepToken = '[SEP]';
  readonly padToken = '[PAD]';
  readonly maskToken = '[MASK]';
  readonly clsId: number;
  readonly sepId: number;
  readonly padId: number;
  readonly maskId: number;
  readonly config: TokenizerConfigEcho;

  private lowercase: boolean;
  private stripAccents: boolean;
  private cleanText: boolean;
  private handleChinese: boolean;
  private postKind: 'template' | 'bert-pair' | 'none';
  private truncationCfg: unknown;
  private paddingCfg: unknown;

  constructor(json: any) {
    const model = json?.model;
    if (!model?.vocab) throw new Error('tokenizer.json missing model.vocab');
    this.vocab = model.vocab instanceof Map ? model.vocab : new Map(Object.entries(model.vocab) as Array<[string, number]>);
    this.unkToken = model.unk_token ?? '[UNK]';
    this.continuingPrefix = model.continuing_subword_prefix ?? '##';
    this.maxInputCharsPerWord = model.max_input_chars_per_word ?? 100;

    const norm = json.normalizer ?? {};
    this.lowercase = norm.lowercase === true;
    // HF：strip_accents 为 null 时取 lowercase 的值
    this.stripAccents = norm.strip_accents === null || norm.strip_accents === undefined ? this.lowercase : norm.strip_accents === true;
    this.cleanText = norm.clean_text !== false;
    this.handleChinese = norm.handle_chinese_chars !== false;

    const post = json.post_processor;
    if (post?.type === 'TemplateProcessing') this.postKind = 'template';
    else if (post?.type === 'BertProcessing') this.postKind = 'bert-pair';
    else this.postKind = 'none';

    this.truncationCfg = json.truncation ?? null;
    this.paddingCfg = json.padding ?? null;

    this.unkId = this.vocab.get(this.unkToken) ?? 100;
    this.clsId = this.vocab.get(this.clsToken) ?? 101;
    this.sepId = this.vocab.get(this.sepToken) ?? 102;
    this.padId = this.vocab.get(this.padToken) ?? 0;
    this.maskId = this.vocab.get(this.maskToken) ?? 103;

    // 具体 token id 以 post_processor 声明为准（若声明了）
    const specials = post?.special_tokens;
    if (specials?.[this.clsToken]?.ids?.[0] != null) (this as any).clsId = specials[this.clsToken].ids[0];
    if (specials?.[this.sepToken]?.ids?.[0] != null) (this as any).sepId = specials[this.sepToken].ids[0];

    this.config = {
      type: model.type ?? 'WordPiece',
      lowercasing: this.lowercase,
      stripAccents: this.stripAccents,
      handleChineseChars: this.handleChinese,
      cleanText: this.cleanText,
      preTokenizer: json.pre_tokenizer?.type ?? 'none',
      postProcessor: post?.type ?? 'none',
      vocabSize: this.vocab.size,
      unkToken: this.unkToken,
      continuingSubwordPrefix: this.continuingPrefix,
      maxInputCharsPerWord: this.maxInputCharsPerWord,
      truncation: this.truncationCfg,
      padding: this.paddingCfg,
    };
  }

  static fromFile(tokenizerPath: string): BertWordPieceFenCiQi {
    return new BertWordPieceFenCiQi(JSON.parse(fs.readFileSync(tokenizerPath, 'utf8')));
  }

  /** BertNormalizer：clean_text → handle_chinese_chars → lowercase → strip_accents */
  normalize(text: string): string {
    let out = '';
    if (this.cleanText) {
      for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0;
        if (cp === 0 || cp === 0xfffd || (isControl(ch) && !isBertWhitespace(ch))) out += ' ';
        else out += ch;
      }
    } else {
      out = text;
    }
    if (this.handleChinese) {
      let s = '';
      for (const ch of out) {
        s += isChineseChar(ch.codePointAt(0) ?? 0) ? ` ${ch} ` : ch;
      }
      out = s;
    }
    if (this.lowercase) out = out.toLowerCase();
    if (this.stripAccents) out = out.normalize('NFD').replace(/\p{Mn}+/gu, '');
    return out;
  }

  /** BertPreTokenizer：空白处切分（丢弃） + 标点独立成词 */
  preTokenize(normalized: string): string[] {
    const out: string[] = [];
    let cur = '';
    for (const ch of normalized) {
      if (isBertWhitespace(ch)) {
        if (cur) out.push(cur);
        cur = '';
        continue;
      }
      if (isPunctuation(ch)) {
        if (cur) out.push(cur);
        cur = '';
        out.push(ch);
        continue;
      }
      cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }

  /** WordPiece 贪心最长匹配 */
  private wordpiece(token: string, out: string[], outIds: number[]): void {
    const chars = Array.from(token);
    if (chars.length > this.maxInputCharsPerWord) {
      out.push(this.unkToken);
      outIds.push(this.unkId);
      return;
    }
    let start = 0;
    while (start < chars.length) {
      let end = chars.length;
      let piece: string | null = null;
      while (start < end) {
        const sub = chars.slice(start, end).join('');
        const cand = start > 0 ? this.continuingPrefix + sub : sub;
        if (this.vocab.has(cand)) {
          piece = cand;
          break;
        }
        end -= 1;
      }
      if (piece === null) {
        out.push(this.unkToken);
        outIds.push(this.unkId);
        start += 1;
      } else {
        out.push(piece);
        outIds.push(this.vocab.get(piece) as number);
        start = end;
      }
    }
  }

  /** 无特殊 token 的纯分词（调试/测试用） */
  tokenize(text: string): string[] {
    const toks: string[] = [];
    const ids: number[] = [];
    for (const t of this.preTokenize(this.normalize(text))) this.wordpiece(t, toks, ids);
    return toks;
  }

  encode(text: string, opts: BianMaXuanXiang = {}): Encoded {
    const maxLength = opts.maxLength ?? 512;
    const addSpecial = opts.addSpecialTokens !== false;
    const toks: string[] = [];
    const body: number[] = [];
    for (const t of this.preTokenize(this.normalize(text))) this.wordpiece(t, toks, body);

    let ids: number[];
    let tokens: string[];
    let typeIds: number[];
    if (addSpecial && this.postKind !== 'none') {
      const budget = Math.max(0, maxLength - 2);
      if (body.length > budget) {
        body.length = budget;
        toks.length = budget;
      }
      ids = [this.clsId, ...body, this.sepId];
      tokens = [this.clsToken, ...toks, this.sepToken];
      typeIds = new Array(ids.length).fill(0);
    } else {
      if (body.length > maxLength) {
        body.length = maxLength;
        toks.length = maxLength;
      }
      ids = body;
      tokens = toks;
      typeIds = new Array(ids.length).fill(0);
    }
    return { ids, tokens, attentionMask: new Array(ids.length).fill(1), tokenTypeIds: typeIds };
  }

  /** 反解（decoder 声明为 WordPiece, prefix '##', cleanup=true） */
  decode(ids: number[]): string {
    const byId = new Map<number, string>();
    for (const [tok, id] of this.vocab) if (!byId.has(id)) byId.set(id, tok);
    const skip = new Set([this.clsId, this.sepId, this.padId]);
    let s = '';
    for (const id of ids) {
      if (skip.has(id)) continue;
      const tok = byId.get(id);
      if (tok === undefined) continue;
      if (tok.startsWith(this.continuingPrefix)) s += tok.slice(this.continuingPrefix.length);
      else s += (s.endsWith(' ') ? '' : ' ') + tok;
    }
    return s.trim();
  }
}
