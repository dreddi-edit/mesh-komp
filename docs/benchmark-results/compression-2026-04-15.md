# Mesh Capsule Compression Benchmark

Generated: 2026-04-15T00:45:21.760Z

```
Compression benchmark — token savings by file size & family
All ratios = compressed/raw. Lower = better compression.

family   size    rawTok  cap%   foc%   trn%  llm80%  tokSaved  +files@128k
code     xs          103 110.7%  10.7%  54.9%   42.7%       -11      -120
code     small       293  19.1%  23.5%  22.4%   20.8%       237 +     1849
code     medium      956   5.9%   7.2%   8.9%   19.8%       900 +     2152
code     large      2881   1.9%   2.4%   4.6%   19.8%      2825 +     2241
code     xl         7694   0.7%   0.9%   3.0%   17.9%      7639 +     2311
code     xxl       19394   0.1%   0.2%   2.4%   16.7%     19367 +     4734
config   xs           47 121.3%  23.4%  73.5%   89.4%       -10      -478
config   small       144 107.6%   7.6%  31.9%   29.9%       -11       -63
config   medium      476   5.5%   8.0%  14.2%   19.1%       450 +     4655
config   large      1439   1.8%   2.6%   8.1%   10.6%      1413 +     4835
config   xl         3842   0.7%   1.0%   5.7%    4.0%      3817 +     5087
config   xxl        9669   0.3%   0.4%   4.9%    1.6%      9644 +     5107
sql      xs           83 110.8%  10.8%  67.2%   50.6%        -9      -151
sql      small       248  16.9%  22.6%  23.6%   18.9%       206 +     2531
sql      medium      827   5.2%   6.8%   7.7%   11.7%       784 +     2822
sql      large      2487   1.7%   2.3%   3.1%    3.9%      2444 +     2925
sql      xl         6637   0.6%   0.8%   1.5%    1.5%      6595 +     3028
sql      xxl       16622   0.3%   0.3%   0.9%    0.6%     16579 +     2969
markup   xs           77 114.3%  14.3%  53.3%   54.5%       -11      -208
markup   small       213  10.3%  16.0%  21.5%   19.3%       191 +     5218
markup   medium      689   3.2%   5.1%   7.9%   19.4%       667 +     5633
markup   large      2059   1.1%   1.7%   3.5%    7.5%      2037 +     5756
markup   xl         5484   0.4%   0.6%   2.0%    2.8%      5462 +     5795
markup   xxl       13754   0.2%   0.3%   1.5%    1.1%     13732 +     5809
docs     xs           86 111.6%  12.8%  61.2%   27.9%       -10      -155
docs     small       259   9.3%  14.3%  22.8%   16.2%       235 +     4839
docs     medium      862   2.8%   4.4%   8.4%   11.8%       838 +     5185
docs     large      2607   0.9%   1.5%   3.9%    8.6%      2583 +     5284
docs     xl         6970   0.3%   0.5%   2.5%    3.2%      6946 +     5315
docs     xxl       17540   0.1%   0.2%   1.8%    1.3%     17516 +     5326

Capsule tier breakdown (token ratio vs raw)
family   size    ultra   medium  loose
code     xs       110.7%   110.7%  110.7%
code     small     19.1%    38.9%   38.6%
code     medium     5.9%    20.7%   37.0%
code     large      1.9%     8.6%   19.6%
code     xl         0.7%     3.2%    7.3%
code     xxl        0.1%     0.4%    0.7%
config   xs       121.3%   121.3%  121.3%
config   small    107.6%   107.6%  107.6%
config   medium     5.5%    22.5%   37.8%
config   large      1.8%     9.3%   19.3%
config   xl         0.7%     3.5%    7.2%
config   xxl        0.3%     1.4%    2.9%
sql      xs       110.8%   110.8%  110.8%
sql      small     16.9%    44.8%   44.8%
sql      medium     5.2%    13.5%   24.8%
sql      large      1.7%    12.0%   19.9%
sql      xl         0.6%     4.5%   12.8%
sql      xxl        0.3%     1.8%    5.1%
markup   xs       114.3%   114.3%  114.3%
markup   small     10.3%    40.8%   69.5%
markup   medium     3.2%    15.1%   29.8%
markup   large      1.1%     5.4%   10.3%
markup   xl         0.4%     2.0%    3.8%
markup   xxl        0.2%     0.8%    1.5%
docs     xs       111.6%   111.6%  111.6%
docs     small      9.3%    35.5%   35.5%
docs     medium     2.8%    19.5%   31.2%
docs     large      0.9%     7.3%   15.4%
docs     xl         0.3%     2.7%    5.8%
docs     xxl        0.1%     1.1%    2.3%

Average by family (token ratios)
code: capsule=23.1%, focused=7.5%, llm80=22.9%, avgTokensSaved=5160
config: capsule=39.5%, focused=7.2%, llm80=25.8%, avgTokensSaved=2551
sql: capsule=22.6%, focused=7.3%, llm80=14.5%, avgTokensSaved=4433
markup: capsule=21.6%, focused=6.3%, llm80=17.4%, avgTokensSaved=3680
docs: capsule=20.8%, focused=5.6%, llm80=11.5%, avgTokensSaved=4685

Crossover (size at which capsule first beats legacy llm80):
  code: small
  config: medium
  sql: small
  markup: small
  docs: small

Overall avg capsule token ratio: 25.5%
Overall avg context gain: capsule fits 3.9x more files than raw
```

## Analysis

On average across all file sizes and content families, the capsule format reduces token usage to **25.5%** of raw source — meaning **3.9× more files** fit in the same context window.

Best compression: **docs** (avg 20.8% of raw). Worst: **config** (avg 39.5% of raw). The difference is primarily due to how structurally repetitive each file type is.

**Small files (<1KB raw, <200 tokens)** are the exception: capsule overhead can _increase_ token count because the format headers, span IDs, and section markers add fixed cost that outweighs savings. At this scale, capsule tokens can reach 100-120% of raw.

**Medium files (2-6KB, 400-1200 tokens)** see capsule reach 10-20% of raw tokens — a 5-10× improvement. This is the sweet spot where structural compression dominates.

**Large files (20KB+, 4000+ tokens)** compress most aggressively: ultra tier routinely reaches 2-5% of raw token count, a **20-50× multiplier** on context capacity.

Capsule first outperforms legacy llm80 at: code at small, config at medium, sql at small, markup at small, docs at small.

**Tier recommendation:**
- `ultra` — default, best for large context packing (5-10× tighter than `loose`)
- `medium` — balanced, use when partial context is acceptable
- `loose` — closest to source, best when LLM needs to see more detail
- `focused` — tightest of all when you have a query (typically 6-12% of raw)