export type Product = {
  id: number;
  sku: string;
  slug: string;
  country: string;
  flag: string;
  region: string;
  operator: string;
  type: "eSIM" | "SIM";
  data: string;
  days: number;
  price: number;
  oldPrice?: number;
  calls?: string;
  popular?: boolean;
  tone: string;
  available: boolean;
};

export const products: Product[] = [
  { id:1, sku:"TR-ESIM-20-30", slug:"turkey-turkcell-20gb", country:"Турция", flag:"🇹🇷", region:"Европа", operator:"Turkcell", type:"eSIM", data:"20 ГБ", days:30, price:2490, oldPrice:2890, popular:true, tone:"from-[#1679f2] to-[#0d46ad]", available:true },
  { id:2, sku:"TH-ESIM-UNL-15", slug:"thailand-ais-unlimited", country:"Таиланд", flag:"🇹🇭", region:"Азия", operator:"AIS", type:"eSIM", data:"Безлимит", days:15, price:3190, calls:"15 минут", tone:"from-[#7047eb] to-[#4020a7]", available:true },
  { id:3, sku:"AE-SIM-10-28", slug:"uae-du-10gb", country:"ОАЭ", flag:"🇦🇪", region:"Ближний Восток", operator:"du", type:"SIM", data:"10 ГБ", days:28, price:3590, calls:"30 минут", tone:"from-[#ef6a39] to-[#bb2c21]", available:true },
  { id:4, sku:"DE-ESIM-30-30", slug:"germany-o2-30gb", country:"Германия", flag:"🇩🇪", region:"Европа", operator:"O2", type:"eSIM", data:"30 ГБ", days:30, price:2790, popular:true, tone:"from-[#10a985] to-[#08705c]", available:true },
  { id:5, sku:"US-ESIM-20-30", slug:"usa-tmobile-20gb", country:"США", flag:"🇺🇸", region:"Америка", operator:"T-Mobile", type:"eSIM", data:"20 ГБ", days:30, price:3990, calls:"Безлимит", tone:"from-[#ef3f92] to-[#a20d5d]", available:true },
  { id:6, sku:"JP-SIM-15-16", slug:"japan-kddi-15gb", country:"Япония", flag:"🇯🇵", region:"Азия", operator:"KDDI", type:"SIM", data:"15 ГБ", days:16, price:2890, tone:"from-[#27344a] to-[#111827]", available:true },
];

export function getProductById(id: number) {
  return products.find((product) => product.id === id);
}
