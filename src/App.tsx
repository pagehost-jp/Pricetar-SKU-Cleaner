import React, { useState, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import * as Encoding from 'encoding-japanese';
import { FileSpreadsheet, Download, AlertCircle, Info, CheckCircle2 } from 'lucide-react';
import './index.css';

interface CsvRow {
  [key: string]: string;
}

interface ProcessedResult {
  fileName: string;
  originalCount: number;
  extractedCount: number;
  previewData: CsvRow[];
  fullData: CsvRow[];
  fields: string[];
}

function App() {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cleanSku = (sku: string): string => {
    if (!sku) return '';
    const trimmed = sku.trim();
    // Excel escape format: ="ABC" -> ABC
    if (trimmed.startsWith('="') && trimmed.endsWith('"')) {
      return trimmed.slice(2, -1);
    }
    return trimmed;
  };

  const isZero = (val: string): boolean => {
    if (!val || val.trim() === '') return false;
    const num = Number(val);
    return !isNaN(num) && num === 0;
  };

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      // 1. Read file as ArrayBuffer
      const buffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);

      // 2. Decode from Shift_JIS to Unicode string
      const unicodeString = Encoding.convert(uint8Array, {
        to: 'UNICODE',
        from: 'SJIS',
        type: 'string',
      }) as string;

      // 3. Parse CSV
      Papa.parse(unicodeString, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const data = results.data as CsvRow[];
          const fields = results.meta.fields || [];

          if (data.length === 0) {
            setError('CSVファイルが空です。');
            setIsProcessing(false);
            return;
          }

          // Case-insensitive search for required columns
          const skuCol = fields.find(f => f.toLowerCase() === 'sku') || 'SKU';
          const qtyCols = ['number', '数量', '在庫', 'qty', 'stock'];
          const qtyCol = fields.find(f => qtyCols.includes(f.toLowerCase()));
          const addDeleteCol = fields.find(f => f.toLowerCase() === 'add-delete') || 'add-delete';

          if (!qtyCol) {
            setError(`在庫数を示す列が見つかりません。(${qtyCols.join(', ')}のいずれかが必要です)`);
            setIsProcessing(false);
            return;
          }

          // 4. Transform data
          const extracted: CsvRow[] = [];

          data.forEach(row => {
            const qtyVal = row[qtyCol];
            if (isZero(qtyVal)) {
              const rawSku = row[skuCol];
              if (rawSku && rawSku.trim() !== '') {
                const pureSku = cleanSku(rawSku);
                const newRow = { ...row };
                newRow[skuCol] = pureSku;
                newRow[addDeleteCol] = 'x';
                extracted.push(newRow);
              }
            }
          });

          // Generate date-based filename
          const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
          const newFileName = `delete_sku_${dateStr}.csv`;

          setResult({
            fileName: newFileName,
            originalCount: data.length,
            extractedCount: extracted.length,
            previewData: extracted.slice(0, 20),
            fullData: extracted,
            fields: fields
          });
          setIsProcessing(false);
        },
        error: (err: any) => {
          setError(`CSV解析エラー: ${err.message}`);
          setIsProcessing(false);
        }
      });

    } catch (err: any) {
      setError(`ファイル読み込みエラー: ${err.message}`);
      setIsProcessing(false);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.csv')) {
        processFile(file);
      } else {
        setError('CSVのみアップロード可能です。');
      }
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const downloadCsv = () => {
    if (!result || result.extractedCount === 0) return;

    // Convert to CSV string keeping original columns
    const csvStr = Papa.unparse({
      fields: result.fields,
      data: result.fullData
    }, {
      quotes: false, // Don't use quotes unless necessary
    });

    // Encode from Unicode string back to Shift_JIS ArrayBuffer
    const sjisArray = Encoding.convert(csvStr, {
      to: 'SJIS',
      from: 'UNICODE',
      type: 'array'
    }) as number[];

    const uint8Array = new Uint8Array(sjisArray);
    const blob = new Blob([uint8Array], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = result.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="App">
      <div className="app-container">

        <header className="header">
          <h1>Pricetar SKU Cleaner</h1>
          <p>在庫0のSKUを安全に一括削除するための専用ツール</p>
        </header>

        <div className="grid-2 animate-slide-up">

          {/* Upload Section */}
          <div className="glass-panel" style={{ padding: '24px' }}>
            <div className="step-indicator">
              <div className="step-number">1</div>
              <span>現在庫CSVをアップロード</span>
            </div>

            <div
              className={`drop-zone ${isDragging ? 'active' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileSpreadsheet size={48} className="drop-icon" />
              <div>
                <strong style={{ fontSize: '1.1rem', display: 'block', marginBottom: '8px' }}>
                  クリックするか、ファイルをドロップ
                </strong>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  プライスターからダウンロードしたCSVをそのままアップロードしてください
                </span>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".csv"
                style={{ display: 'none' }}
              />
            </div>

            <div className="info-text" style={{ marginTop: '24px' }}>
              <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>
                <strong>安全設計:</strong> このツールはブラウザ上だけで完結するため、商品データが外部サーバーに送信されることは一切ありません。
              </span>
            </div>

            {error && (
              <div className="warning-text" style={{ marginTop: '16px' }}>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {isProcessing && (
              <div style={{ textAlign: 'center', marginTop: '20px', color: 'var(--accent-color)' }}>
                <div className="spinner"></div>
                ⏳ 解析中...
              </div>
            )}
          </div>

          {/* Result Section */}
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div className="step-indicator">
              <div className="step-number">2</div>
              <span>削除用CSVをダウンロード</span>
            </div>

            {!result ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', opacity: 0.5, flexDirection: 'column', gap: '16px' }}>
                <Download size={48} />
                <p>ファイルがアップロードされていません</p>
              </div>
            ) : (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

                <div className="stat-card">
                  <div>
                    <div className="stat-label">対象SKU（在庫0）</div>
                    <div className="stat-value">{result.extractedCount} <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 500 }}>件 / {result.originalCount}件中</span></div>
                  </div>
                  <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '12px', borderRadius: '50%', color: 'var(--success-color)' }}>
                    <CheckCircle2 size={24} />
                  </div>
                </div>

                {result.extractedCount > 1000 && (
                  <div className="warning-text" style={{ marginBottom: '16px' }}>
                    <AlertCircle size={16} />
                    <span>警告: 1000件を超えています。プライスターの処理に時間がかかる場合があります。</span>
                  </div>
                )}

                {result.extractedCount === 0 ? (
                  <div className="stat-card warning" style={{ justifyContent: 'center', flexDirection: 'column', textAlign: 'center', gap: '12px' }}>
                    <AlertCircle size={32} color="var(--error-color)" />
                    <div>
                      <strong>削除対象が見つかりません</strong>
                      <p className="stat-label" style={{ marginTop: '4px' }}>在庫数が「0」の商品はありませんでした。</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
                      <span>プレビュー (先頭{result.previewData.length}件)</span>
                      <span className="badge orange">add-delete列付与済</span>
                    </h3>

                    <div className="preview-table-container">
                      <table className="preview-table">
                        <thead>
                          <tr>
                            <th>SKU</th>
                            <th>商品名 (TITLE)</th>
                            <th style={{ width: '100px' }}>add-delete</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.previewData.map((row, idx) => {
                            const titleCol = result.fields.find(f => f.toLowerCase() === 'title') || 'title';
                            const titleStr = row[titleCol] || '';
                            const shortTitle = titleStr.length > 25 ? titleStr.substring(0, 25) + '...' : titleStr;
                            const addDeleteCol = result.fields.find(f => f.toLowerCase() === 'add-delete') || 'add-delete';
                            const skuCol = result.fields.find(f => f.toLowerCase() === 'sku') || 'SKU';
                            return (
                              <tr key={idx}>
                                <td style={{ fontFamily: 'monospace', color: '#E2E8F0' }}>{row[skuCol]}</td>
                                <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }} title={titleStr}>{shortTitle}</td>
                                <td><span className="badge green">{row[addDeleteCol]}</span></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div style={{ marginTop: '24px', flex: 1, display: 'flex', alignItems: 'flex-end' }}>
                      <button
                        className="btn-primary"
                        onClick={downloadCsv}
                        disabled={result.extractedCount === 0}
                      >
                        <Download size={20} />
                        削除用CSVをダウンロード
                      </button>
                    </div>

                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '16px', textAlign: 'center' }}>
                      ※このファイルをプライスターにアップロードすると、<br />セラーセントラル側の商品も連動して削除されます。
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;
