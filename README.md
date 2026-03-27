# FRAME_Floor_Plan 📐

Mask Floor Plan Layout Generator & Coordinate Export Tool built with **Reflex**.

This tool allows you to design and manage mask layouts, perform precise measurements, optimize field sizes, and export coordinates to Excel (Dual-Origin) and GDSII formats.

## 🚀 Key Features

- **Precise Layout Management**: Add and drag chips with scribe lane constraints.
- **Dual-Origin Excel Export**: Get coordinates relative to both Bottom-Left and Frame Center in one Excel sheet.
- **GDSII Export**: Generate industrial-standard GDSII layout files directly.
- **Auto-Optimization**: Automatically shrink the exposure field to fit the current chips with scribe margins.
- **Measurement Tool**: Built-in ruler to measure precise distances between chips.
- **Mobile Responsive UI**: Works across different screen sizes with a clean, dark-themed professional interface.

## 🛠️ Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/sejm99/FRAME_Floor_Plan.git
   cd FRAME_Floor_Plan
   ```

2. **Install dependencies**:
   Ensure you have Python 3.9+ installed, then run:
   ```bash
   pip install -r requirements.txt
   ```

3. **Initialize & Run**:
   ```bash
   reflex init
   reflex run
   ```

4. **Access the App**:
   Open your browser and go to `http://localhost:3000`.

## 📦 Requirements

- `reflex`
- `pandas`
- `gdstk`
- `numpy`
- `openpyxl`
- `pydantic`

## 📄 License
This project is for layout design and research purposes.
