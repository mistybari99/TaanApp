export function downloadCsvTemplate() {
  const headers = ["memberId", "name", "mobile", "address", "shares", "dailyAmount", "joiningDate", "status"];
  const rows = [
    ["M-001", "আব্দুর রহমান (Abdur Rahman)", "01711000000", "ঢাকা (Dhaka)", "1", "100", "2024-01-01", "active"],
    ["M-002", "করিম মিয়া (Karim Mia)", "01811000000", "চট্টগ্রাম (Chittagong)", "2", "200", "2024-01-02", "active"]
  ];
  
  const csvContent = [
    headers.join(","),
    ...rows.map(e => e.join(","))
  ].join("\n");
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", "members_template.csv");
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function parseCsv(file: File): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = String(event.target?.result ?? "").replace(/^\uFEFF/, "");
      if (!text.trim()) return resolve([]);

      const records: string[][] = [];
      let record: string[] = [];
      let field = "";
      let quoted = false;
      for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (char === '"') {
          if (quoted && text[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            quoted = !quoted;
          }
        } else if (char === "," && !quoted) {
          record.push(field.trim());
          field = "";
        } else if ((char === "\n" || char === "\r") && !quoted) {
          if (char === "\r" && text[i + 1] === "\n") i += 1;
          record.push(field.trim());
          if (record.some(value => value.length > 0)) records.push(record);
          record = [];
          field = "";
        } else {
          field += char;
        }
      }
      if (field.length > 0 || record.length > 0) {
        record.push(field.trim());
        if (record.some(value => value.length > 0)) records.push(record);
      }

      if (records.length < 2) return resolve([]);
      const headers = records[0].map((header) => header.trim());
      const result = records.slice(1).map((values) => {
        const obj: Record<string, unknown> = {};
        headers.forEach((header, index) => {
          obj[header] = values[index] ?? "";
        });
        if (obj.shares !== "") obj.shares = Number(obj.shares);
        if (obj.dailyAmount !== "") obj.dailyAmount = Number(obj.dailyAmount);
        return obj;
      });
      resolve(result);
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsText(file);
  });
}