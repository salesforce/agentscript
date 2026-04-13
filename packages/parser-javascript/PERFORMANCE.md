# Parser-TS Performance Report

> Auto-generated on 2026-03-21 18:46:14 UTC
> Node: v22.19.0 | Commit: 3b04bc5d

## Summary

| Benchmark | Size | Mean | Throughput | ops/s |
|---|---|---|---|---|
| parse 50,000 lines | 1.3 MB | 124.54 ms | 10.5 KB/ms | 8 |
| parse 5,000 lines | 130.2 KB | 10.17 ms | 12.8 KB/ms | 98 |
| parse 100,000 lines | 2.2 MB | 208.69 ms | 10.7 KB/ms | 5 |
| parse 10,000 lines | 202.9 KB | 15.48 ms | 13.1 KB/ms | 65 |
| parse 50,000 keys | 1003.7 KB | 87.00 ms | 11.5 KB/ms | 11 |
| parse 5,000 strings | 648.3 KB | 25.78 ms | 25.1 KB/ms | 39 |
| parse 10,000 lines (50% errors) | 175.2 KB | 18.53 ms | 9.5 KB/ms | 54 |
| parse 50,000 items | 623.9 KB | 60.60 ms | 10.3 KB/ms | 17 |
| parse 10,000 terms | 77.0 KB | 12.29 ms | 6.3 KB/ms | 81 |

## Scaling Analysis

| Dimension | 1K | 10K | 10x Factor | Assessment |
|---|---|---|---|---|
| Flat mappings | 602.5 µs | 15.48 ms | 25.7x | super-linear |
| Wide mappings | 457.2 µs | 14.73 ms | 32.2x | super-linear |
| Sequences | 349.4 µs | 9.93 ms | 28.4x | super-linear |
| Chained expr | 263.3 µs | 12.29 ms | 46.7x | super-linear |
| Escape strings | 237.4 µs | 5.09 ms | 21.4x | super-linear |
| Error recovery | 672.3 µs | 18.53 ms | 27.6x | super-linear |

## Lexer vs Parser

| Input | Lex Time | Parse Time | Lex % |
|---|---|---|---|
| parse 10,000 lines | 1.89 ms | 15.48 ms | 12% |
| parse 100,000 lines | 44.20 ms | 208.69 ms | 21% |
| parse 5,000 lines | 1.49 ms | 10.17 ms | 15% |
| parse 50,000 lines | 32.77 ms | 124.54 ms | 26% |

## Highlighting Overhead

| Input | Parse Only | Parse+Highlight | Overhead |
|---|---|---|---|
| 100 lines | 128.4 µs | 143.0 µs | +11% |
| 1,000 lines | 683.0 µs | 1.32 ms | +93% |
| 5,000 lines | 10.17 ms | 13.43 ms | +32% |

## Detailed Results

### File Size Scaling (flat key: value mappings)

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse 100 lines | 117.8 µs | 397.1 µs | 8,487 | 13.9 KB/ms | 1.6 KB |
| parse 1,000 lines | 602.5 µs | 1.00 ms | 1,660 | 30.4 KB/ms | 18.3 KB |
| parse 10,000 lines | 15.48 ms | 23.25 ms | 65 | 13.1 KB/ms | 202.9 KB |
| parse 50,000 lines | 90.43 ms | 119.84 ms | 11 | 12.2 KB/ms | 1.1 MB |
| parse 100,000 lines | 208.69 ms | 286.59 ms | 5 | 10.7 KB/ms | 2.2 MB |
| lex-only 100 lines | 27.6 µs | 13.1 µs | 36,278 | 59.5 KB/ms | 1.6 KB |
| lex-only 1,000 lines | 147.3 µs | 659.0 µs | 6,791 | 124.5 KB/ms | 18.3 KB |
| lex-only 10,000 lines | 1.89 ms | 2.66 ms | 529 | 107.4 KB/ms | 202.9 KB |
| lex-only 50,000 lines | 19.86 ms | 25.58 ms | 50 | 55.5 KB/ms | 1.1 MB |
| lex-only 100,000 lines | 44.20 ms | 78.06 ms | 23 | 50.3 KB/ms | 2.2 MB |

### Deep Nesting (indent levels)

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse depth=50 | 102.8 µs | 162.8 µs | 9,728 | 29.0 KB/ms | 3.0 KB |
| parse depth=100 | 60.9 µs | 66.9 µs | 16,423 | 178.0 KB/ms | 10.8 KB |
| parse depth=200 | 163.9 µs | 172.8 µs | 6,103 | 252.1 KB/ms | 41.3 KB |
| parse depth=500 | 818.4 µs | 1.25 ms | 1,222 | 305.3 KB/ms | 249.9 KB |
| parse depth=1000 | 2.72 ms | 3.28 ms | 367 | 363.1 KB/ms | 988.2 KB |

### Wide Mappings (sibling keys at same level)

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse 1,000 keys | 457.2 µs | 658.9 µs | 2,187 | 35.9 KB/ms | 16.4 KB |
| parse 5,000 keys | 6.86 ms | 9.29 ms | 146 | 13.2 KB/ms | 90.6 KB |
| parse 10,000 keys | 14.73 ms | 19.52 ms | 68 | 12.4 KB/ms | 183.4 KB |
| parse 50,000 keys | 87.00 ms | 118.09 ms | 11 | 11.5 KB/ms | 1003.7 KB |

### Chained Expressions (a + b + c + ...)

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse 100 terms | 51.4 µs | 50.7 µs | 19,442 | 11.3 KB/ms | 595 B |
| parse 500 terms | 114.8 µs | 447.2 µs | 8,711 | 28.9 KB/ms | 3.3 KB |
| parse 1,000 terms | 263.3 µs | 801.4 µs | 3,798 | 25.6 KB/ms | 6.7 KB |
| parse 5,000 terms | 2.49 ms | 2.79 ms | 401 | 15.2 KB/ms | 38.0 KB |
| parse 10,000 terms | 12.29 ms | 21.16 ms | 81 | 6.3 KB/ms | 77.0 KB |

### Nested Parentheses ((((...)))) 

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse depth=50 | 42.1 µs | 23.0 µs | 23,739 | 2.5 KB/ms | 109 B |
| parse depth=100 | 20.4 µs | 28.7 µs | 49,012 | 10.0 KB/ms | 209 B |
| parse depth=200 | 36.8 µs | 44.0 µs | 27,154 | 10.8 KB/ms | 409 B |
| parse depth=500 | 87.0 µs | 197.6 µs | 11,494 | 11.3 KB/ms | 1009 B |
| parse depth=1000 | 195.7 µs | 617.0 µs | 5,110 | 10.0 KB/ms | 2.0 KB |

### Mixed Precedence (+ * - / interleaved)

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse 100 terms | 34.2 µs | 46.9 µs | 29,263 | 17.0 KB/ms | 595 B |
| parse 500 terms | 119.8 µs | 433.9 µs | 8,345 | 27.7 KB/ms | 3.3 KB |
| parse 1,000 terms | 276.2 µs | 810.9 µs | 3,621 | 24.4 KB/ms | 6.7 KB |
| parse 5,000 terms | 2.59 ms | 2.83 ms | 387 | 14.7 KB/ms | 38.0 KB |

### Large String Literals

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse 1K char string | 22.8 µs | 56.3 µs | 43,881 | 43.2 KB/ms | 1009 B |
| parse 10K char string | 49.0 µs | 55.1 µs | 20,408 | 199.5 KB/ms | 9.8 KB |
| parse 100K char string | 466.3 µs | 483.7 µs | 2,145 | 209.5 KB/ms | 97.7 KB |
| parse 1000K char string | 4.80 ms | 5.33 ms | 208 | 203.3 KB/ms | 976.6 KB |

### Escape-Heavy Strings

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse 100 strings | 237.4 µs | 621.8 µs | 4,212 | 53.8 KB/ms | 12.8 KB |
| parse 500 strings | 1.61 ms | 1.85 ms | 621 | 40.0 KB/ms | 64.3 KB |
| parse 1,000 strings | 5.09 ms | 7.19 ms | 197 | 25.3 KB/ms | 128.8 KB |
| parse 5,000 strings | 25.78 ms | 31.45 ms | 39 | 25.1 KB/ms | 648.3 KB |

### Template Interpolations

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse 50 interpolations | 60.4 µs | 83.2 µs | 16,563 | 14.6 KB/ms | 901 B |
| parse 200 interpolations | 96.2 µs | 367.0 µs | 10,395 | 37.6 KB/ms | 3.6 KB |
| parse 500 interpolations | 242.4 µs | 638.5 µs | 4,125 | 37.9 KB/ms | 9.2 KB |
| parse 1000 interpolations | 480.2 µs | 845.7 µs | 2,082 | 38.4 KB/ms | 18.5 KB |

### Error Recovery — alternating valid/invalid lines

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse 100 lines (50% errors) | 88.3 µs | 265.5 µs | 11,326 | 18.7 KB/ms | 1.7 KB |
| parse 1,000 lines (50% errors) | 672.3 µs | 1.13 ms | 1,488 | 25.3 KB/ms | 17.0 KB |
| parse 5,000 lines (50% errors) | 7.99 ms | 11.27 ms | 125 | 10.9 KB/ms | 87.3 KB |
| parse 10,000 lines (50% errors) | 18.53 ms | 26.97 ms | 54 | 9.5 KB/ms | 175.2 KB |

### Error Recovery — garbage input

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse 1K bytes garbage | 21.7 µs | 35.4 µs | 46,022 | 44.9 KB/ms | 1000 B |
| parse 10K bytes garbage | 62.0 µs | 96.8 µs | 16,121 | 157.4 KB/ms | 9.8 KB |
| parse 50K bytes garbage | 270.4 µs | 594.7 µs | 3,698 | 180.6 KB/ms | 48.8 KB |
| parse 100K bytes garbage | 529.5 µs | 942.1 µs | 1,889 | 184.4 KB/ms | 97.7 KB |

### Error Recovery — unclosed delimiters

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse 100 unclosed parens | 90.2 µs | 327.7 µs | 11,081 | 18.1 KB/ms | 1.6 KB |
| parse 500 unclosed parens | 442.9 µs | 775.2 µs | 2,258 | 21.3 KB/ms | 9.4 KB |
| parse 1,000 unclosed parens | 844.8 µs | 1.07 ms | 1,184 | 22.7 KB/ms | 19.2 KB |
| parse 5,000 unclosed parens | 13.16 ms | 17.79 ms | 76 | 8.3 KB/ms | 109.1 KB |

### Large Sequences (- item)

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse 1,000 items | 349.4 µs | 629.0 µs | 2,862 | 30.4 KB/ms | 10.6 KB |
| parse 10,000 items | 9.93 ms | 13.79 ms | 101 | 11.7 KB/ms | 116.1 KB |
| parse 50,000 items | 60.60 ms | 75.42 ms | 17 | 10.3 KB/ms | 623.9 KB |

### Procedure-Heavy (if/run/set statements)

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse 100 statements | 198.2 µs | 451.3 µs | 5,046 | 17.3 KB/ms | 3.4 KB |
| parse 500 statements | 475.9 µs | 863.7 µs | 2,101 | 37.5 KB/ms | 17.9 KB |
| parse 1,000 statements | 1.01 ms | 1.37 ms | 993 | 35.7 KB/ms | 35.9 KB |
| parse 5,000 statements | 12.58 ms | 18.89 ms | 80 | 15.0 KB/ms | 188.3 KB |

### Highlighting Overhead (parse vs parse+highlight)

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse-only 100 lines | 128.4 µs | 206.3 µs | 7,790 | 21.5 KB/ms | 2.8 KB |
| parse+highlight 100 lines | 143.0 µs | 306.3 µs | 6,993 | 19.3 KB/ms | 2.8 KB |
| parse-only 1,000 lines | 683.0 µs | 915.2 µs | 1,464 | 38.1 KB/ms | 26.0 KB |
| parse+highlight 1,000 lines | 1.32 ms | 1.90 ms | 759 | 19.8 KB/ms | 26.0 KB |
| parse-only 5,000 lines | 10.17 ms | 13.16 ms | 98 | 12.8 KB/ms | 130.2 KB |
| parse+highlight 5,000 lines | 13.43 ms | 18.71 ms | 74 | 9.7 KB/ms | 130.2 KB |

### Realistic Agent Files

| Benchmark | Mean | p95 | ops/s | Throughput | Size |
|---|---|---|---|---|---|
| parse 50 lines | 50.3 µs | 53.2 µs | 19,894 | 27.5 KB/ms | 1.4 KB |
| parse 500 lines | 330.8 µs | 505.0 µs | 3,023 | 39.8 KB/ms | 13.2 KB |
| parse 5,000 lines | 10.17 ms | 15.55 ms | 98 | 12.8 KB/ms | 130.2 KB |
| parse 50,000 lines | 124.54 ms | 163.22 ms | 8 | 10.5 KB/ms | 1.3 MB |
| lex-only 500 lines | 114.1 µs | 152.2 µs | 8,763 | 115.4 KB/ms | 13.2 KB |
| lex-only 5,000 lines | 1.49 ms | 2.62 ms | 671 | 87.4 KB/ms | 130.2 KB |
| lex-only 50,000 lines | 32.77 ms | 45.65 ms | 31 | 39.8 KB/ms | 1.3 MB |

