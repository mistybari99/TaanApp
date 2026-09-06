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
      const text = event.target?.result as string;
      if (!text) return resolve([]);
      
      const lines = text.split(/\r\n|\n/).filter(line => line.trim().length > 0);
      if (lines.length < 2) return resolve([]);
      
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const result = [];
      
      for (let i = 1; i < lines.length; i++) {
        // Simple CSV parse, assuming no commas inside quotes for this basic app
        const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const obj: any = {};
        headers.forEach((h, index) => {
          obj[h] = values[index];
        });
        
        // Coerce types
        if (obj.shares) obj.shares = Number(obj.shares);
        if (obj.dailyAmount) obj.dailyAmount = Number(obj.dailyAmount);
        
        result.push(obj);
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsText(file);
  });
}