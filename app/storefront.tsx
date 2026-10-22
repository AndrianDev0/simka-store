"use client";
function formatPrice(value:number|null,currency="RUB"){if(value===null)return "Нет в наличии";try{return new Intl.NumberFormat("ru-RU",{style:"currency",currency,maximumFractionDigits:0}).format(value)}catch{return `${new Intl.NumberFormat("ru-RU").format(value)} ${currency}`}}
function productWord(count:number){const mod100=count%100,mod10=count%10;if(mod100>=11&&mod100<=14)return "товаров";if(mod10===1)return "товар";if(mod10>=2&&mod10<=4)return "товара";return "товаров"}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, CircleHelp, Headphones, LoaderCircle, Menu, Minus, Plus, Search, ShieldCheck, ShoppingBag, TicketPercent, Trash2, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { BrandMark } from "@/app/components/brand-mark";
import { CountryFlag } from "@/app/components/country-flag";
import { ProductPreview } from "@/app/components/product-preview";
import { SiteFooter } from "@/app/components/site-footer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAnalyticsClientId, trackEvent, trackOnce, type AnalyticsItem } from "@/lib/analytics";
import { parseStoredCart, serializeCart } from "@/lib/cart-storage";
import { productDisplayOffer, productIsAvailable, validityLabel, variantIsAvailable, type Product, type ProductVariant } from "@/lib/catalog";
import { getEmailValidationError } from "@/lib/email-validation";
const regions = ["Все направления", "Европа", "Азия", "Ближний Восток", "Америка"];
type OrderReceipt = { number: string; paymentMethod: "crypto" | "manager"; checkoutUrl?: string; managerNotified: boolean; customerNotified: boolean; value: number; currency: string; promoCode?: string; discountAmount?: number; items: AnalyticsItem[] };
type CheckoutCustomer = { name: string; email: string; contact: string };
const cryptoPaymentEnabled = process.env.NEXT_PUBLIC_CRYPTO_PAYMENT_ENABLED === "true";
const CART_STORAGE_KEY = "simka-cart-v1";
type CartLine = { key: string; product: Product; variant: ProductVariant | null; quantity: number; price: number; currency: string; sku: string; data: string; days: number | null };

function createBrowserUuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function variantIsPurchasable(variant: ProductVariant) { return variantIsAvailable(variant); }
function productIsPurchasable(product: Product) { return productIsAvailable(product); }
function defaultVariant(product: Product) { return productDisplayOffer(product).variant; }
function cartKey(productId: number, variantId: number | null) { return `${productId}:${variantId ?? 0}`; }
function analyticsItem(line: CartLine, quantity = line.quantity): AnalyticsItem {
  return { item_id: line.sku, item_name: line.product.name, item_category: line.product.type, item_variant: line.variant?.name, price: line.price, quantity };
}

type HomeCategory = { id: string; slug: string; name: string; description: string; productIds: { length: number } };
export default function Storefront({categories=[],products:initialProducts,totalProducts,customer}:{categories?:HomeCategory[];products:Product[];totalProducts:number;customer?:CheckoutCustomer}) {
  const [bootstrapProducts,setBootstrapProducts]=useState(initialProducts);
  const [bootstrapReady,setBootstrapReady]=useState(false);
  const [cartReady,setCartReady]=useState(false);
  const [cartLoadError,setCartLoadError]=useState(false);
  const [bootstrapAttempt,setBootstrapAttempt]=useState(0);
  const [listing,setListing]=useState({items:initialProducts,total:totalProducts});
  const [knownProducts,setKnownProducts]=useState<Product[]>([]);
  const products=useMemo(()=>[...new Map([...bootstrapProducts,...knownProducts].map(product=>[product.id,product])).values()],[bootstrapProducts,knownProducts]);
  const [page,setPage]=useState(1);
  const [catalogLoading,setCatalogLoading]=useState(false);
  const [catalogError,setCatalogError]=useState(false);
  const [catalogAttempt,setCatalogAttempt]=useState(0);
  const [query,updateQuery]=useState(""); const [region,updateRegion]=useState("Все направления"); const [type,updateType]=useState("Все типы");
  const setQuery=(value:string)=>{setPage(1);updateQuery(value);};
  const setRegion=(value:string)=>{setPage(1);updateRegion(value);};
  const setType=(value:string)=>{setPage(1);updateType(value);};
  const [cart,setCart]=useState<Record<string,number>>({}); const [cartOpen,setCartOpen]=useState(false); const [checkout,setCheckout]=useState(false); const [ordered,setOrdered]=useState<OrderReceipt|null>(null); const [mobileMenu,setMobileMenu]=useState(false);
  const cartHydrated=useRef(false);
  const visible=listing.items;

  useEffect(()=>{
    const controller=new AbortController();
    async function restoreProducts(){
      try{
        let stored:Record<string,number>={};
        try{stored=parseStoredCart(localStorage.getItem(CART_STORAGE_KEY));}catch{}
        const params=new URLSearchParams(location.search);
        const ids=Object.keys(stored).map(key=>Number(key.split(":")[0]));
        const requested=Number(params.get("product"));
        if(Number.isSafeInteger(requested)&&requested>0)ids.push(requested);
        if(params.get("reorder")){
          const response=await fetch(`/api/account/reorder?order=${encodeURIComponent(params.get("reorder")!)}`,{signal:controller.signal});
          if(!response.ok)throw new Error("reorder");
          const data=await response.json() as {items:Array<{productId:number}>};
          ids.push(...data.items.map(item=>item.productId));
        }
        const unique=[...new Set(ids)].filter(id=>Number.isSafeInteger(id)&&id>0);
        const loaded:Product[]=[];
        for(let offset=0;offset<unique.length;offset+=100){
          const response=await fetch(`/api/catalog?ids=${unique.slice(offset,offset+100).join(",")}`,{signal:controller.signal});
          if(!response.ok)throw new Error("cart");
          const data=await response.json() as {items:Product[]};
          loaded.push(...data.items);
        }
        if(controller.signal.aborted)return;
        setBootstrapProducts([...new Map([...initialProducts,...loaded].map(product=>[product.id,product])).values()]);
        setCartLoadError(false);setBootstrapReady(true);
      }catch{if(!controller.signal.aborted)setCartLoadError(true);}
    }
    void restoreProducts();
    return()=>controller.abort();
  },[initialProducts,bootstrapAttempt]);

  useEffect(()=>{
    if(!query&&region==="Все направления"&&type==="Все типы"&&page===1){
      const resetTimer=setTimeout(()=>{
        setListing({items:initialProducts,total:totalProducts});
        setCatalogLoading(false);
        setCatalogError(false);
      },0);
      return()=>clearTimeout(resetTimer);
    }
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      setCatalogLoading(true);setCatalogError(false);
      const params=new URLSearchParams({q:query,region:region==="Все направления"?"":region,type:type==="Все типы"?"":type,page:String(page)});
      void fetch(`/api/catalog?${params}`,{signal:controller.signal}).then(async response=>{
        if(!response.ok)throw new Error("catalog");
        const result=await response.json() as {items:Product[];total:number};
        if(controller.signal.aborted)return;
        setListing(result);
        setKnownProducts(current=>[...new Map([...current,...result.items].map(product=>[product.id,product])).values()]);
        if(query)trackEvent("search",{query_length:Math.min(query.length,100),results_count:result.total,no_results:result.total===0,search_location:"home"});
        if(region!=="Все направления"||type!=="Все типы")trackEvent("catalog_filter",{region,sim_type:type,results_count:result.total,filter_location:"home"});
      }).catch(()=>{if(!controller.signal.aborted)setCatalogError(true);}).finally(()=>{if(!controller.signal.aborted)setCatalogLoading(false);});
    },250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query,region,type,page,catalogAttempt,initialProducts,totalProducts]);
  const cartItems=useMemo<CartLine[]>(()=>Object.entries(cart).flatMap(([key,quantity])=>{const [productId,variantId]=key.split(":").map(Number);const product=products.find(item=>item.id===productId);if(!product || product.price === null)return[];const variant=variantId?product.variants.find(item=>item.id===variantId)??null:null;return [{key,product,variant,quantity,price:variant?.price??product.price,currency:variant?.currency??product.currency,sku:variant?.sku??product.sku,data:variant?.data??product.data,days:variant?.days??product.days}]}),[cart,products]);
  const cartCount=cartItems.reduce((sum,line)=>sum+line.quantity,0); const total=cartItems.reduce((sum,line)=>sum+line.price*line.quantity,0); const cartCurrencies=[...new Set(cartItems.map(line=>line.currency))]; const cartCurrency=cartCurrencies[0]??"RUB"; const mixedCurrencies=cartCurrencies.length>1;
  const add=useCallback((id:number,variantId?:number)=>{const product=products.find(item=>item.id===id);if(!product||!productIsPurchasable(product))return;const selected=variantId?product.variants.find(item=>item.id===variantId&&variantIsPurchasable(item))??null:defaultVariant(product);if(product.variants.length&&!selected)return;const key=cartKey(id,selected?.id??null);const stock=selected?.stockQuantity??product.stockQuantity;const previous=cart[key]||0;const next=stock===null?previous+1:Math.min(stock,previous+1);setCart(current=>({...current,[key]:stock===null?((current[key]||0)+1):Math.min(stock,(current[key]||0)+1)}));if(next>previous){const line:CartLine={key,product,variant:selected,quantity:next-previous,price:selected?.price??product.price,currency:selected?.currency??product.currency,sku:selected?.sku??product.sku,data:selected?.data??product.data,days:selected?.days??product.days};trackEvent("add_to_cart",{currency:line.currency,value:line.price*(next-previous),items:[analyticsItem(line,next-previous)]})}},[cart,products]);
  const change=(key:string,amount:number)=>{const [productId,variantId]=key.split(":").map(Number);const product=products.find(item=>item.id===productId);const variant=variantId?product?.variants.find(item=>item.id===variantId):null;const stock=variant?.stockQuantity??product?.stockQuantity??null;const previous=cart[key]||0;const requested=Math.max(0,previous+amount);const next=stock===null?requested:Math.min(stock,requested);if(product&&product.price !== null&&next!==previous){const quantity=Math.abs(next-previous);const line:CartLine={key,product,variant:variant??null,quantity,price:variant?.price??product.price,currency:variant?.currency??product.currency,sku:variant?.sku??product.sku,data:variant?.data??product.data,days:variant?.days??product.days};trackEvent(amount>0?"add_to_cart":"remove_from_cart",{currency:line.currency,value:line.price*quantity,items:[analyticsItem(line,quantity)]})}setCart(current=>{const updated={...current,[key]:next};if(!next)delete updated[key];return updated})};

  useEffect(()=>{
    if(!bootstrapReady)return;
    const products=bootstrapProducts;
    let stored:Record<string,number>={};
    try{stored=parseStoredCart(window.localStorage.getItem(CART_STORAGE_KEY));}catch{/* Storage can be disabled by the browser. */}
    const restored:Record<string,number>={};
    for(const [key,quantity] of Object.entries(stored)){
      const [productId,variantId]=key.split(":").map(Number);
      const product=products.find(item=>item.id===productId&&productIsPurchasable(item));
      if(!product)continue;
      const variant=variantId?product.variants.find(item=>item.id===variantId&&variantIsPurchasable(item))??null:null;
      if((variantId&&!variant)||(product.variants.length&&!variant))continue;
      const stock=variant?.stockQuantity??product.stockQuantity;
      const available=stock===null?quantity:Math.min(quantity,stock);
      if(available>0)restored[key]=available;
    }
    const timer=window.setTimeout(()=>{
      setCart(restored);
      cartHydrated.current=true;
      setCartReady(true);
    },0);
    return()=>window.clearTimeout(timer);
  },[bootstrapProducts,bootstrapReady]);

  useEffect(()=>{
    if(!cartHydrated.current)return;
    try{
      if(Object.keys(cart).length)window.localStorage.setItem(CART_STORAGE_KEY,serializeCart(cart));
      else window.localStorage.removeItem(CART_STORAGE_KEY);
    }catch{/* Checkout still works when browser storage is unavailable. */}
  },[cart]);

  useEffect(()=>{
    if(!cartReady)return;
    const products=bootstrapProducts;
    const params=new URLSearchParams(window.location.search);
    const requestedReorder=params.get("reorder")?.trim();
    if(requestedReorder){
      let cancelled=false;
      void fetch(`/api/account/reorder?order=${encodeURIComponent(requestedReorder)}`,{credentials:"same-origin",headers:{Accept:"application/json"}})
        .then(response=>response.ok?response.json():null)
        .then((payload:unknown)=>{
          if(cancelled||!payload||typeof payload!=="object"||!Array.isArray((payload as {items?:unknown}).items))return;
          const items=(payload as {items:Array<{productId?:unknown;variantId?:unknown;quantity?:unknown}>}).items;
          const additions:Record<string,number>={};
          for(const item of items){
            const productId=typeof item.productId==="number"?item.productId:Number(item.productId);
            const variantId=typeof item.variantId==="number"?item.variantId:(item.variantId?Number(item.variantId):null);
            const quantity=typeof item.quantity==="number"?item.quantity:Number(item.quantity);
            const product=products.find(candidate=>candidate.id===productId&&productIsPurchasable(candidate));
            if(!product||!Number.isInteger(quantity)||quantity<1)continue;
            const selected=variantId&&Number.isInteger(variantId)?product.variants.find(variant=>variant.id===variantId&&variantIsPurchasable(variant))??null:defaultVariant(product);
            if(product.variants.length&&!selected)continue;
            const stock=selected?.stockQuantity??product.stockQuantity;
            const key=cartKey(product.id,selected?.id??null);
            const available=stock===null?quantity:Math.min(stock,quantity);
            if(available>0)additions[key]=Math.min(stock===null?Number.MAX_SAFE_INTEGER:stock,(additions[key]??0)+available);
          }
          if(!Object.keys(additions).length)return;
          setCart(current=>{
            const merged={...current};
            for(const [key,quantity] of Object.entries(additions)){
              const [productId,variantId]=key.split(":").map(Number);
              const product=products.find(candidate=>candidate.id===productId);
              const variant=variantId?product?.variants.find(candidate=>candidate.id===variantId):null;
              const stock=variant?.stockQuantity??product?.stockQuantity??null;
              merged[key]=stock===null?((merged[key]??0)+quantity):Math.min(stock,(merged[key]??0)+quantity);
            }
            return merged;
          });
          window.history.replaceState(null,"",`${window.location.pathname}${window.location.hash||"#catalog"}`);
          setCartOpen(true);
        })
        .catch(()=>{});
      return ()=>{cancelled=true;};
    }
    const requestedProduct=Number(params.get("product")); const requestedVariant=Number(params.get("variant"));
    if(Number.isInteger(requestedProduct)&&products.some(product=>product.id===requestedProduct&&productIsPurchasable(product))){
      window.history.replaceState(null,"",`${window.location.pathname}${window.location.hash||"#catalog"}`);
      const timer=window.setTimeout(()=>{
        const product=products.find(item=>item.id===requestedProduct)!;const selected=Number.isInteger(requestedVariant)&&requestedVariant>0?product.variants.find(item=>item.id===requestedVariant&&variantIsPurchasable(item))??defaultVariant(product):defaultVariant(product);if(product.variants.length&&!selected)return;const key=cartKey(product.id,selected?.id??null);const stock=selected?.stockQuantity??product.stockQuantity;
        setCart(current=>({...current,[key]:stock===null?Math.max(1,current[key]||0):Math.min(stock,Math.max(1,current[key]||0))}));
        setCartOpen(true);
      },0);
      return ()=>window.clearTimeout(timer);
    }
  },[bootstrapProducts,cartReady]);

  useEffect(()=>{
    const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options?:{signal?:AbortSignal})=>void|Promise<void>}}).modelContext;
    if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    void Promise.resolve(context.registerTool({
      name:"add_tariff_to_cart", title:"Добавить тариф в корзину",
      description:"Добавляет один выбранный тариф SIMKA в корзину по его числовому идентификатору.",
      inputSchema:{type:"object",properties:{productId:{type:"integer",minimum:1,maximum:Math.max(1,...products.map(product=>product.id))}},required:["productId"],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute(input:unknown){const id=(input as {productId?:unknown})?.productId;if(typeof id!=="number"||!products.some(p=>p.id===id&&productIsPurchasable(p)))throw new Error("Тариф недоступен");add(id);return {productId:id,status:"added"};}
    },{signal:lifecycle.signal})).catch(()=>{});
    return ()=>lifecycle.abort();
  },[add,products]);

  return <main className="min-h-screen bg-background text-foreground">
    {!bootstrapReady&&<div role={cartLoadError?"alert":"status"} className="border-b bg-card px-4 py-3 text-sm text-foreground">{cartLoadError?<>Не удалось восстановить корзину. Сохранённые товары не удалены. <button className="min-h-11 px-3 underline" onClick={()=>setBootstrapAttempt(attempt=>attempt+1)}>Повторить</button></>:"Проверяем сохранённую корзину…"}</div>}
    <div className="hidden border-b border-[#dce7f4] bg-[#edf7ff] px-4 py-2 text-center text-[13px] font-medium text-[#164475] sm:block"><span className="inline-flex items-center gap-2">eSIM на email после оплаты · Помощь с выбором тарифа</span></div>
    <header className="sticky top-0 z-40 border-b border-border/80 bg-white/90 backdrop-blur-xl"><div className="mx-auto flex h-16 max-w-[1240px] items-center gap-2 px-3 sm:h-[72px] sm:gap-3 sm:px-6 lg:gap-8">
      <a href="#top" className="flex shrink-0 items-center gap-2.5" aria-label="SIMKA - на главную"><Logo/></a>
      <nav className="hidden items-center gap-7 text-[14px] font-semibold text-[#42526a] lg:flex"><a className="hover:text-[#1168e8]" href="#catalog">Каталог</a><a className="hover:text-[#1168e8]" href="/categories">Категории</a><a className="hover:text-[#1168e8]" href="/countries">Страны</a><a className="hover:text-[#1168e8]" href="#faq">FAQ</a></nav>
      <div className="ml-auto flex items-center gap-2">
        <div className="hidden items-center gap-2 md:flex"><Button asChild variant="ghost" className="h-11 rounded-xl text-[#42526a]"><a href="/account">Кабинет</a></Button><Button asChild variant="ghost" className="h-11 rounded-xl text-[#42526a]"><a href="/contacts"><Headphones className="size-4" aria-hidden="true"/>Помощь</a></Button></div><a href="/account" aria-label="Личный кабинет" title="Личный кабинет" className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-transparent text-foreground shadow-none hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:hidden"><UserRound className="size-5" aria-hidden="true"/></a><ThemeToggle/>
        <Cart open={cartOpen} onOpenChange={(open)=>{setCartOpen(open);if(open&&cartItems.length)trackEvent("view_cart",{currency:cartCurrency,value:total,items:cartItems.map((line)=>analyticsItem(line))})}} items={cartItems} count={cartCount} total={total} currency={cartCurrency} mixedCurrencies={mixedCurrencies} checkout={checkout} ordered={ordered} customer={customer} onChange={change} onCheckout={setCheckout} onBeginCheckout={()=>trackEvent("begin_checkout",{currency:cartCurrency,value:total,items:cartItems.map((line)=>analyticsItem(line))})} onOrder={(receipt)=>{trackOnce(`order-created:${receipt.number}`,"generate_lead",{transaction_id:receipt.number,currency:receipt.currency,value:receipt.value,coupon:receipt.promoCode,items:receipt.items});setOrdered(receipt);setCart({});setCheckout(false)}}/>
        <button onClick={()=>setMobileMenu(!mobileMenu)} className="grid size-11 place-items-center rounded-xl border border-border bg-transparent text-foreground shadow-none hover:bg-muted sm:bg-card sm:shadow-sm lg:hidden" aria-expanded={mobileMenu} aria-controls="mobile-navigation" aria-label={mobileMenu?"Закрыть меню":"Открыть меню"}>{mobileMenu?<X className="size-5"/>:<Menu className="size-5"/>}</button>
      </div>
    </div>{mobileMenu&&<nav id="mobile-navigation" className="grid gap-1 border-t bg-white p-4 text-sm font-semibold lg:hidden">{[["Каталог","#catalog"],["Категории","/categories"],["Страны","/countries"],["Как это работает","#how"],["Доставка","/delivery"],["FAQ","#faq"],["Личный кабинет","/account"]].map(([label,href])=><a key={href} onClick={()=>setMobileMenu(false)} className="flex min-h-11 items-center rounded-lg px-3 hover:bg-muted" href={href}>{label}</a>)}</nav>}</header>

    <section id="top" className="theme-hero relative overflow-hidden border-b border-[#dce7f4] bg-[#f7fbff]"><div className="relative mx-auto grid max-w-[1240px] items-center gap-8 px-4 py-10 sm:px-6 sm:py-12 lg:grid-cols-[1.1fr_.9fr] lg:py-16"><div>
      <h1 className="max-w-[720px] text-[clamp(34px,9.5vw,68px)] font-black leading-[.98] tracking-[-0.055em] text-[#10213a]">eSIM и SIM<br/><span className="text-[#1168e8]">для путешествий</span></h1>
      <p className="mt-5 max-w-[570px] text-base leading-7 text-[#56667c] sm:text-lg">{products.length > 0 && products.every(p => p.sku.startsWith("DEMO-")) ? "Пока здесь примеры тарифов: можно посмотреть страны и условия, но оформить покупку нельзя." : "Выберите eSIM для нужной страны. Перед оплатой проверьте состав пакета и условия активации."}</p>
      <div className="mt-7 flex max-w-[680px] flex-col gap-3 rounded-2xl border border-[#cbdced] bg-white p-2.5 shadow-[0_16px_50px_rgba(29,72,121,.12)] sm:flex-row"><SearchBox value={query} onChange={setQuery}/><Button onClick={()=>document.querySelector("#catalog")?.scrollIntoView({behavior:"smooth"})} className="theme-gradient-button h-12 rounded-xl px-7 text-base font-bold">Найти тариф<ArrowRight className="size-4"/></Button></div>
      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[13px] font-medium text-[#51647a]">{["Цена и условия до заказа","Инструкция по активации","Поддержка на русском"].map(t=><span key={t} className="flex items-center gap-1.5"><Check className="size-4 text-[#68a71a]"/>{t}</span>)}</div>
    </div><HeroCards products={products}/></div></section>

    {categories.filter(category=>category.productIds.length>0).length>1&&<section id="categories" className="border-b border-[#dce7f4] bg-white"><div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6 sm:py-12"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="mb-2 text-xs font-black uppercase tracking-[.16em] text-[#1168e8]">Категории</p><h2 className="text-2xl font-black tracking-[-.03em] text-[#10213a] sm:text-3xl">Подборки тарифов</h2></div><a href="/categories" className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl px-3 font-bold text-[#1168e8] hover:bg-[#edf5ff]">Все категории <ArrowRight className="size-4" aria-hidden="true"/></a></div><div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{categories.filter(category=>category.productIds.length>0).map(category=><a key={category.id} href={`/category/${category.slug}`} className="group rounded-2xl border border-[#dbe5ef] bg-[#f8fbfe] p-5 transition hover:border-[#9fc5f4] hover:bg-white hover:shadow-[0_14px_35px_rgba(23,58,96,.08)]"><div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-black text-[#10213a] group-hover:text-[#1168e8]">{category.name}</h3><p className="mt-2 line-clamp-2 text-sm leading-6 text-[#637389]">{category.description||"Подборка доступных тарифов SIMKA."}</p></div><ArrowRight className="mt-1 size-5 shrink-0 text-[#1168e8]" aria-hidden="true"/></div><p className="mt-4 text-xs font-bold uppercase tracking-wide text-[#7a899a]">{category.productIds.length} {productWord(category.productIds.length)}</p></a>)}</div></div></section>}

    <section id="catalog" className="mx-auto max-w-[1240px] px-4 py-14 sm:px-6 sm:py-20"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Предложения по странам</h2></div><p className="max-w-[390px] text-sm leading-6 text-muted-foreground">{products.length > 0 && products.every(p => p.sku.startsWith("DEMO-")) ? "Демонстрационный каталог. Цены и условия приведены для примера, покупка недоступна." : "Сравните комплектацию и цену. У некоторых eSIM тариф оплачивается отдельно."}</p></div>
      <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-[#dbe5ef] bg-[#f8fbfe] p-3 sm:flex-row"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#7890a8]" aria-hidden="true"/><Input value={query} onChange={e=>setQuery(e.target.value)} aria-label="Поиск тарифов" className="h-11 rounded-xl border-[#dbe5ef] bg-white pl-10 shadow-none" placeholder="Страна или оператор"/></div><Filter label="Регион" value={region} onChange={setRegion} values={regions}/><Filter label="Тип SIM" value={type} onChange={setType} values={["Все типы","eSIM","SIM"]} narrow/></div>
      {catalogLoading?<p role="status" className="py-12 text-muted-foreground">Загружаем тарифы…</p>:catalogError?<div role="alert" className="py-8"><p>Не удалось загрузить тарифы.</p><Button variant="outline" className="mt-3 min-h-11" onClick={()=>setCatalogAttempt(attempt=>attempt+1)}>Повторить загрузку</Button></div>:visible.length?<fieldset disabled={!bootstrapReady} className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visible.map(p=><ProductCard key={p.id} product={p} count={cartItems.filter(line=>line.product.id===p.id).reduce((sum,line)=>sum+line.quantity,0)} onAdd={()=>add(p.id)}/>)}</fieldset>:<div className="mt-6 rounded-2xl border border-dashed py-16 text-center"><Search className="mx-auto mb-3 size-7 text-muted-foreground"/><h3 className="font-bold">{totalProducts ? "Тарифы не найдены" : "Каталог пока пуст"}</h3><p className="mt-1 text-sm text-muted-foreground">{totalProducts ? "Попробуйте изменить страну или тип SIM." : "Опубликованных тарифов пока нет. Заказать SIM или eSIM можно будет после их добавления."}</p></div>}
      {!catalogLoading&&!catalogError&&listing.total>24&&<nav aria-label="Страницы тарифов" className="mt-6 flex flex-wrap items-center justify-center gap-4"><Button variant="outline" className="min-h-11" disabled={page===1} onClick={()=>setPage(current=>current-1)}>Назад</Button><span aria-live="polite" className="text-sm">{page} из {Math.ceil(listing.total/24)}</span><Button variant="outline" className="min-h-11" disabled={page*24>=listing.total} onClick={()=>setPage(current=>current+1)}>Далее</Button></nav>}
    </section>

    <section id="how" className="border-y border-border bg-muted py-12"><div className="mx-auto grid max-w-[1240px] gap-8 px-4 sm:px-6 md:grid-cols-2"><h2 className="text-3xl font-bold tracking-tight text-foreground">Перед покупкой eSIM</h2><div className="space-y-4 text-base leading-7 text-muted-foreground"><p>Проверьте, поддерживает ли ваш телефон eSIM и не заблокирован ли он под одного оператора.</p><p>В условиях тарифа уточните, когда начинается срок действия, можно ли раздавать интернет и включены ли звонки.</p><a href="/faq" className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4">Вопросы о подключении</a></div></div></section>

    <section id="delivery" className="mx-auto max-w-[1240px] px-4 py-12 sm:px-6"><h2 className="text-2xl font-bold text-foreground">Получение заказа</h2><p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">Для eSIM нужен email, для физической SIM также потребуется адрес доставки. Способ и срок получения проверяйте до оплаты.</p><a href="/delivery" className="mt-3 inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4">Условия доставки</a></section>
    <Faq/>
    <SiteFooter/>
  </main>;
}

function Logo(){return <BrandMark/>}
function SearchBox({value,onChange}:{value:string;onChange:(v:string)=>void}){return <div className="relative flex-1"><Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#7090b1]" aria-hidden="true"/><Input value={value} onChange={e=>onChange(e.target.value)} className="h-12 border-0 bg-transparent pl-12 text-base shadow-none focus-visible:ring-3" placeholder="Куда вы едете?" aria-label="Поиск по странам и операторам"/></div>}
function Filter({label,value,onChange,values,narrow=false}:{label:string;value:string;onChange:(v:string)=>void;values:string[];narrow?:boolean}){return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className={`h-11 w-full rounded-xl border-[#dbe5ef] bg-white ${narrow?"sm:w-[150px]":"sm:w-[200px]"}`}><SelectValue/></SelectTrigger><SelectContent>{values.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select>}
function HeroCards({products}:{products:Product[]}) {
  const destinations=Array.from(new Map(products.map(product=>[product.countryId,product])).values()).slice(0,4);
  if(!destinations.length)return null;
  const demo=products.every(product=>product.sku.startsWith("DEMO-"));
  return <aside aria-labelledby="hero-directions" className="mx-auto w-full max-w-[430px] rounded-xl border border-border bg-card p-6 text-card-foreground sm:p-8">
    <h2 id="hero-directions" className="text-xl font-bold tracking-tight">Куда отправляетесь?</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{demo?"Демонстрационный каталог. Тарифы пока не продаются.":"Выберите направление и сравните условия тарифов."}</p>
    <ul className="mt-6 divide-y divide-border">{destinations.map(product=><li key={product.countryId}>
      <a href={`/catalog?country=${encodeURIComponent(product.country)}`} className="flex min-h-16 items-center gap-4 rounded-sm py-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <CountryFlag flag={product.flag} country={product.country} className="h-6 w-9 shrink-0 rounded-sm"/>
        <span className="flex-1 text-base font-semibold">{product.country}</span>
        <span className="text-sm text-muted-foreground">{demo?"Примеры":"Тарифы"}</span><ArrowRight aria-hidden="true" className="size-4 shrink-0"/>
      </a>
    </li>)}</ul>
    <a href="/countries" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Все направления</a>
  </aside>;
}

function Cart({open,onOpenChange,items,count,total,currency,mixedCurrencies,checkout,ordered,customer,onChange,onCheckout,onBeginCheckout,onOrder}:{open:boolean;onOpenChange:(open:boolean)=>void;items:CartLine[];count:number;total:number;currency:string;mixedCurrencies:boolean;checkout:boolean;ordered:OrderReceipt|null;customer?:CheckoutCustomer;onChange:(key:string,n:number)=>void;onCheckout:(v:boolean)=>void;onBeginCheckout:()=>void;onOrder:(receipt:OrderReceipt)=>void}){return <Sheet open={open} onOpenChange={onOpenChange}><SheetTrigger asChild><Button aria-label={count?`Корзина, товаров: ${count}`:"Корзина пуста"} variant="outline" className="relative size-11 rounded-xl border-border bg-transparent p-0 text-foreground shadow-none hover:bg-muted hover:text-foreground sm:h-11 sm:w-auto sm:bg-card sm:px-4 sm:shadow-sm"><ShoppingBag className="size-[18px]" aria-hidden="true"/><span className="hidden sm:inline">Корзина</span>{count>0&&<span aria-live="polite" className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-[#b7f34a] text-[11px] font-black text-[#10213a]">{count}</span>}</Button></SheetTrigger><SheetContent className="w-full border-l-[#dce5f0] bg-white p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-[470px]"><SheetHeader className="border-b border-border px-5 py-5 sm:px-6"><SheetTitle className="text-xl">Ваша корзина</SheetTitle><SheetDescription>{count?`${count} ${productWord(count)}`:"Пока здесь пусто"}</SheetDescription></SheetHeader>{ordered?<OrderDone receipt={ordered}/>:checkout?<Checkout items={items} total={total} currency={currency} customer={customer} onBack={()=>onCheckout(false)} onOrder={onOrder}/>:items.length?<CartList items={items} total={total} currency={currency} mixedCurrencies={mixedCurrencies} onChange={onChange} onCheckout={()=>{onBeginCheckout();onCheckout(true)}}/>:<div className="flex flex-1 flex-col items-center justify-center px-6 text-center sm:px-8"><span className="mb-4 grid size-16 place-items-center rounded-full bg-[#edf5ff] text-[#1168e8]"><ShoppingBag className="size-7"/></span><h3 className="text-xl font-bold text-[#10213a]">Выберите подходящую SIM</h3><p className="mt-2 text-sm text-muted-foreground">Добавленные тарифы появятся здесь.</p></div>}</SheetContent></Sheet>}
function OrderDone({receipt}:{receipt:OrderReceipt}){return <div className="flex flex-1 flex-col items-center justify-center px-8 text-center"><span className="mb-5 grid size-16 place-items-center rounded-full bg-[#e8fbd0] text-[#4b8012]"><Check className="size-8"/></span><h3 className="text-2xl font-bold text-[#10213a]">Заказ создан</h3><p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">Номер заказа <strong className="text-[#10213a]">{receipt.number}</strong>. Сохраните его.</p>{receipt.promoCode&&<p className="mt-3 rounded-full bg-green-50 px-3 py-1.5 text-xs font-bold text-green-700">Промокод {receipt.promoCode} · скидка {formatPrice(receipt.discountAmount??0,receipt.currency)}</p>}{receipt.paymentMethod==="crypto"?<><p className="mt-4 max-w-xs rounded-xl bg-[#edf7ff] p-3 text-sm leading-6 text-[#28577f]">Оплатите заказ на странице Plisio. Статус обновится после подтверждения платежа.</p>{receipt.checkoutUrl&&<Button asChild className="mt-4 h-12 rounded-xl bg-[#1168e8] px-6 hover:bg-[#0d56c3]"><a href={receipt.checkoutUrl}>Перейти к оплате</a></Button>}</>:<p className={`mt-4 max-w-xs rounded-xl p-3 text-sm leading-6 ${receipt.managerNotified?"bg-[#edf7ff] text-[#28577f]":"bg-amber-50 text-amber-800"}`}>{receipt.managerNotified?`Менеджер получил заказ. Реквизиты для оплаты придут на email, указанный при оформлении.${receipt.customerNotified?" Подтверждение заказа уже отправлено.":" Сохраните номер выше: автоматическое письмо-подтверждение сейчас не доставлено."} После оплаты менеджер подтвердит платёж и начнёт выдачу eSIM или отправку SIM.`:"Заказ сохранён, но уведомление менеджеру временно не доставлено. Сообщите номер заказа через раздел «Контакты»."}</p>}</div>}
function Checkout({items,total,currency,customer,onBack,onOrder}:{items:CartLine[];total:number;currency:string;customer?:CheckoutCustomer;onBack:()=>void;onOrder:(receipt:OrderReceipt)=>void}){
  const [loading,setLoading]=useState(false);const [error,setError]=useState("");const [emailError,setEmailError]=useState("");
  const [promoInput,setPromoInput]=useState("");const [promoLoading,setPromoLoading]=useState(false);const [promoError,setPromoError]=useState("");const [appliedPromo,setAppliedPromo]=useState<{code:string;discountAmount:number}|null>(null);
  const requestId=useRef(createBrowserUuid());
  const physicalProducts=useMemo(()=>[...new Map(items.filter(line=>line.product.type==="SIM").map(line=>[line.product.id,line.product])).values()],[items]);
  const [deliveryChoices,setDeliveryChoices]=useState<Record<number,string>>(()=>Object.fromEntries(physicalProducts.map(product=>[product.id,product.deliveryOptions[0]?.id??""])));
  const chosenDelivery=physicalProducts.map(product=>product.deliveryOptions.find(option=>option.id===deliveryChoices[product.id])??null);
  const missingDelivery=chosenDelivery.some(option=>!option);
  const deliveryCurrencyMismatch=chosenDelivery.some(option=>Boolean(option&&option.cost!==null&&option.currency!==currency));
  const deliveryTotal=chosenDelivery.reduce((sum,option)=>sum+(option?.currency===currency?option.cost??0:0),0);
  const deliveryRequiresConfirmation=chosenDelivery.some(option=>Boolean(option&&(option.cost===null||option.regions.length>0)));
  const finalTotal=total-(appliedPromo?.discountAmount??0)+deliveryTotal;
  async function applyPromo(){
    const code=promoInput.trim().toUpperCase();setPromoError("");setAppliedPromo(null);
    if(!code){setPromoError("Введите промокод");return}
    setPromoLoading(true);
    try{const response=await fetch("/api/promocodes/validate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,subtotalAmount:total,currency})});const data=await response.json() as {error?:string;promo?:{code:string;discountAmount:number}};if(!response.ok||!data.promo)throw new Error(data.error||"Не удалось проверить промокод");setPromoInput(data.promo.code);setAppliedPromo(data.promo);trackEvent("promo_code_applied",{coupon:data.promo.code,currency,value:data.promo.discountAmount})}catch(reason){setPromoError(reason instanceof Error?reason.message:"Не удалось проверить промокод")}finally{setPromoLoading(false)}
  }

  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setError("");const formElement=event.currentTarget;const form=new FormData(formElement);const emailMessage=getEmailValidationError(String(form.get("customerEmail")||""));
    if(emailMessage){setEmailError(emailMessage);const emailInput=formElement.elements.namedItem("customerEmail");if(emailInput instanceof HTMLElement)emailInput.focus();return}
    setEmailError("");setLoading(true);
    trackEvent("add_payment_info",{payment_type:String(form.get("paymentMethod")||"manager"),currency,value:finalTotal,items:items.map((line)=>analyticsItem(line))});
    try{
      const query=typeof window!=="undefined"?new URLSearchParams(window.location.search):null;
      const analytics={clientId:getAnalyticsClientId()||undefined,source:query?.get("utm_source")||undefined,medium:query?.get("utm_medium")||undefined,campaign:query?.get("utm_campaign")||undefined,content:query?.get("utm_content")||undefined,term:query?.get("utm_term")||undefined};
      const response=await fetch("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:requestId.current,customerName:form.get("customerName"),customerEmail:form.get("customerEmail"),customerContact:form.get("customerContact"),deliveryAddress:form.get("deliveryAddress")||undefined,customerComment:form.get("customerComment"),paymentMethod:form.get("paymentMethod"),promoCode:appliedPromo?.code,analytics,items:items.map(line=>({productId:line.product.id,variantId:line.variant?.id,quantity:line.quantity})),deliverySelections:physicalProducts.map(product=>({productId:product.id,optionId:deliveryChoices[product.id]}))})});
      const data=await response.json() as {error?:string;retryWithNewRequestId?:boolean;order?:{orderNumber?:string;paymentMethod?:"crypto"|"manager";checkoutUrl?:string;managerNotified?:boolean;customerNotified?:boolean;totalAmount?:number;currency?:string;promoCode?:string;discountAmount?:number}};
      if(!response.ok||!data.order?.orderNumber){if(data.retryWithNewRequestId)requestId.current=createBrowserUuid();throw new Error(data.error||"Не удалось создать заказ")}
      onOrder({number:data.order.orderNumber,paymentMethod:data.order.paymentMethod??(form.get("paymentMethod")==="crypto"?"crypto":"manager"),checkoutUrl:data.order.checkoutUrl,managerNotified:data.order.managerNotified===true,customerNotified:data.order.customerNotified===true,value:typeof data.order.totalAmount === "number" ? data.order.totalAmount : total,currency:data.order.currency || currency,promoCode:data.order.promoCode,discountAmount:data.order.discountAmount,items:items.map((line)=>analyticsItem(line))});
    }catch(reason){trackEvent("checkout_error",{error_type:reason instanceof Error?reason.name:"UnknownError"});setError(reason instanceof Error?reason.message:"Не удалось создать заказ")}finally{setLoading(false)}
  }

  return <form className="flex flex-1 flex-col overflow-y-auto p-5 sm:p-6" onSubmit={submit}>
    <button type="button" onClick={onBack} className="mb-5 min-h-11 w-fit text-sm font-semibold text-[#1168e8]">← Вернуться в корзину</button><h3 className="mb-5 text-xl font-bold text-[#10213a]">Оформление заказа</h3>
    {error&&<div role="alert" tabIndex={-1} className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="space-y-4">{customer&&<p className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">Данные подставлены из вашего профиля. Их можно изменить для этого заказа.</p>}<FormField name="customerName" label="Имя" placeholder="Как к вам обращаться" autoComplete="name" defaultValue={customer?.name}/><FormField name="customerEmail" label="Email для получения реквизитов" placeholder="mail@example.com" email autoComplete="email" defaultValue={customer?.email} error={emailError} onBlur={(value)=>setEmailError(getEmailValidationError(value)??"")} onChange={(value)=>{if(emailError&&!getEmailValidationError(value))setEmailError("")}}/><p className="-mt-2 text-xs leading-5 text-muted-foreground">Укажите email для писем по заказу и получения eSIM. {!customer&&<a href="/account/login?returnTo=/" className="font-bold text-[#1168e8] hover:underline">Войти в кабинет</a>}</p><FormField name="customerContact" label="Telegram или телефон" placeholder="@username" optional autoComplete="tel" defaultValue={customer?.contact}/>
      {physicalProducts.length>0&&<><FormField name="deliveryAddress" label="Адрес доставки" placeholder="Город, улица, дом, квартира" autoComplete="street-address" maxLength={500}/><fieldset className="space-y-3"><legend className="text-sm font-semibold">Доставка физической SIM</legend>{physicalProducts.map(product=><label key={product.id} className="block rounded-xl border border-[#dbe5ef] bg-[#f8fbfe] p-3 text-sm"><span className="mb-2 block font-bold text-[#10213a]">{product.name}</span>{product.deliveryOptions.length?<select required value={deliveryChoices[product.id]??""} onChange={event=>setDeliveryChoices(current=>({...current,[product.id]:event.target.value}))} className="h-11 w-full rounded-lg border border-input bg-white px-3"><option value="" disabled>Выберите способ</option>{product.deliveryOptions.map(option=><option key={option.id} value={option.id}>{option.label} · {option.cost===null?"стоимость уточнит менеджер":formatPrice(option.cost,option.currency)}{option.regions.length?" · регион проверит менеджер":""}</option>)}</select>:<span role="alert" className="text-red-700">Для товара пока не настроен способ доставки.</span>}</label>)}</fieldset></>}
      <label className="block text-sm font-semibold" htmlFor="customerComment">Комментарий<span className="font-normal text-muted-foreground"> - необязательно</span><textarea id="customerComment" name="customerComment" maxLength={1000} className="mt-2 min-h-20 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" placeholder="Например, удобное время для связи"/></label>
      <div className="rounded-xl border border-[#dbe5ef] bg-[#f8fbfe] p-3"><label className="text-sm font-semibold" htmlFor="promoCode">Промокод<span className="font-normal text-muted-foreground"> - необязательно</span></label><div className="mt-2 flex gap-2"><div className="relative min-w-0 flex-1"><TicketPercent aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#637389]"/><Input id="promoCode" value={promoInput} onChange={event=>{setPromoInput(event.target.value.toUpperCase());setAppliedPromo(null);setPromoError("")}} maxLength={32} autoCapitalize="characters" autoComplete="off" spellCheck={false} className="h-11 rounded-xl pl-9 uppercase" placeholder="Например, WELCOME10" aria-invalid={Boolean(promoError)} aria-describedby={promoError?"promo-error":appliedPromo?"promo-success":undefined}/></div><Button type="button" variant="outline" disabled={promoLoading||!promoInput.trim()} onClick={applyPromo} className="h-11 rounded-xl px-4">{promoLoading?<LoaderCircle className="animate-spin"/>:"Применить"}</Button></div>{promoError&&<p id="promo-error" role="alert" className="mt-2 text-xs font-medium text-red-700">{promoError}</p>}{appliedPromo&&<p id="promo-success" role="status" className="mt-2 text-xs font-bold text-green-700">Промокод применён · скидка {formatPrice(appliedPromo.discountAmount,currency)}</p>}</div>
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Способ оплаты</legend><label className={`flex min-h-12 items-center gap-3 rounded-xl border p-4 text-sm ${cryptoPaymentEnabled&&!deliveryRequiresConfirmation?"cursor-pointer border-[#dbe5ef] bg-white text-[#10213a]":"bg-[#f7f8fa] text-[#7a899a]"}`}><input disabled={!cryptoPaymentEnabled||deliveryRequiresConfirmation} name="paymentMethod" value="crypto" type="radio"/><span><strong className="block">Криптовалюта{!cryptoPaymentEnabled?" - недоступна":""}</strong>{cryptoPaymentEnabled&&<span className="mt-1 block text-xs text-[#637389]">Оплата на странице Plisio</span>}</span></label><label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-[#1168e8] bg-[#f4f9ff] p-4 text-sm"><input defaultChecked name="paymentMethod" value="manager" type="radio"/><span><strong className="block text-[#10213a]">По реквизитам через менеджера</strong><span className="mt-1 block text-xs text-[#637389]">Реквизиты придут на указанный email</span></span></label></fieldset>
    </div>
    <div className="mt-5 space-y-2 rounded-xl border border-[#dbe5ef] bg-white p-4 text-sm"><p className="flex justify-between gap-4 text-[#52657a]"><span>Товары</span><strong>{formatPrice(total,currency)}</strong></p>{appliedPromo&&<p className="flex justify-between gap-4 text-green-700"><span>Скидка · {appliedPromo.code}</span><strong>−{formatPrice(appliedPromo.discountAmount,currency)}</strong></p>}{deliveryTotal>0&&<p className="flex justify-between gap-4 text-[#52657a]"><span>Доставка</span><strong>{formatPrice(deliveryTotal,currency)}</strong></p>}<p className="flex justify-between gap-4 border-t border-[#e5edf5] pt-2 font-black text-[#10213a]"><span>Итого</span><strong>{formatPrice(finalTotal,currency)}</strong></p></div>
    {deliveryRequiresConfirmation&&<p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">Сумма предварительная. Менеджер проверит доступность доставки для вашего адреса и подтвердит итог до отправки реквизитов.</p>}
    {deliveryCurrencyMismatch&&<p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-800">Выбранная доставка указана в другой валюте. Выберите другой вариант или оформите товары отдельно.</p>}
    <Button disabled={loading||missingDelivery||deliveryCurrencyMismatch} type="submit" className="theme-gradient-button mt-6 h-auto min-h-12 whitespace-normal rounded-xl py-3 text-center text-base leading-5 disabled:animate-none disabled:opacity-50">{loading?<><LoaderCircle className="animate-spin"/>Создаём заказ…</>:<>Создать заказ · {deliveryRequiresConfirmation?"предварительно ":""}{formatPrice(finalTotal,currency)}</>}</Button><p className="mt-3 text-center text-xs leading-5 text-muted-foreground">Нажимая кнопку, вы соглашаетесь с <a className="underline hover:text-[#1168e8]" href="/terms">условиями использования</a> и <a className="underline hover:text-[#1168e8]" href="/privacy">политикой конфиденциальности</a>.</p>
  </form>
}
function FormField({name,label,placeholder,email=false,optional=false,autoComplete,maxLength,defaultValue,error="",onBlur,onChange}:{name:string;label:string;placeholder:string;email?:boolean;optional?:boolean;autoComplete:string;maxLength?:number;defaultValue?:string;error?:string;onBlur?:(value:string)=>void;onChange?:(value:string)=>void}){const errorId=`${name}-error`;return <label className="block text-sm font-semibold" htmlFor={name}>{label}{optional&&<span className="font-normal text-muted-foreground"> - необязательно</span>}<Input id={name} name={name} required={!optional} type={email?"email":"text"} inputMode={email?"email":undefined} autoCapitalize={email?"none":undefined} spellCheck={email?false:undefined} autoComplete={autoComplete} maxLength={maxLength??(email?254:100)} defaultValue={defaultValue} aria-invalid={Boolean(error)} aria-describedby={error?errorId:undefined} onBlur={(event)=>onBlur?.(event.currentTarget.value)} onChange={(event)=>onChange?.(event.currentTarget.value)} className={`mt-2 h-11 rounded-xl ${error?"border-red-500 focus-visible:ring-red-200":""}`} placeholder={placeholder}/>{error&&<span id={errorId} role="alert" className="mt-2 block text-xs font-medium leading-5 text-red-700">{error}</span>}</label>}
function CartList({items,total,currency,mixedCurrencies,onChange,onCheckout}:{items:CartLine[];total:number;currency:string;mixedCurrencies:boolean;onChange:(key:string,n:number)=>void;onCheckout:()=>void}){return <div className="flex flex-1 flex-col overflow-hidden"><div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-6">{items.map(line=><div key={line.key} className="flex gap-3 rounded-2xl border border-border bg-[#f9fbfd] p-3 sm:gap-4 sm:p-4"><CountryFlag flag={line.product.flag} country={line.product.country} className="mt-1 h-6 w-9"/><div className="min-w-0 flex-1"><p className="font-bold text-[#10213a]">{line.product.country} · {line.data}</p><p className="mt-1 break-words text-xs text-muted-foreground">{line.variant?.name??line.product.type} · {validityLabel(line.days)} · {line.sku}</p><div className="mt-3 flex items-center gap-2"><Qty label="Уменьшить количество" onClick={()=>onChange(line.key,-1)}><Minus/></Qty><span className="w-5 text-center text-sm font-bold">{line.quantity}</span><Qty label="Увеличить количество" onClick={()=>onChange(line.key,1)}><Plus/></Qty></div></div><div className="shrink-0 text-right"><p className="text-sm font-bold sm:text-base">{formatPrice(line.price*line.quantity,line.currency)}</p><button onClick={()=>onChange(line.key,-line.quantity)} aria-label={`Удалить ${line.product.name}`} className="mt-2 grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4"/></button></div></div>)}</div><div className="border-t bg-white p-5 sm:p-6"><div className="mb-4 flex justify-between gap-4 text-base font-bold sm:text-lg"><span>Стоимость товаров</span><span className="shrink-0">{mixedCurrencies?"-":formatPrice(total,currency)}</span></div>{mixedCurrencies&&<p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Товары в разных валютах нужно оформить отдельными заказами.</p>}<Button disabled={mixedCurrencies} onClick={onCheckout} className="h-auto min-h-12 w-full whitespace-normal rounded-xl bg-[#1168e8] px-4 py-3 text-center text-sm leading-5 hover:bg-[#0d56c3] sm:text-base">Перейти к оформлению<ArrowRight className="shrink-0"/></Button><div className="mt-4 flex items-start justify-center gap-2 text-center text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#439313]"/>Цена и наличие проверяются перед оплатой</div></div></div>}
function Qty({onClick,children,label}:{onClick:()=>void;children:React.ReactNode;label:string}){return <button onClick={onClick} aria-label={label} className="grid size-11 place-items-center rounded-lg border bg-white [&_svg]:size-4">{children}</button>}

function ProductCard({product,count,onAdd}:{product:Product;count:number;onAdd:()=>void}){
  return <ProductPreview product={product}>
    <div className="flex flex-wrap gap-2">
      <a href={`/product/${encodeURIComponent(product.slug)}`} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted">Подробнее</a>
      {productIsPurchasable(product)&&<Button onClick={onAdd} className="h-11 flex-1 rounded-lg bg-primary px-3 font-semibold text-primary-foreground hover:bg-primary/90">{count?`В корзине · ${count}`:"В корзину"}</Button>}
    </div>
  </ProductPreview>;
}
function Faq(){const items=[{q:"Как проверить, поддерживает ли телефон eSIM?",a:"В настройках устройства найдите пункт «Добавить eSIM» или «Добавить сотовый тариф». Перед покупкой также проверьте модель в списке совместимых устройств."},{q:"Когда начинается срок действия тарифа?",a:"Начало срока зависит от тарифа. Если это условие не указано в карточке, уточните его у поддержки до оплаты."},{q:"Можно ли раздать интернет?",a:"Возможность раздачи зависит от тарифа и правил оператора. Проверьте характеристики выбранного предложения или уточните это у менеджера до оплаты."}];return <section id="faq" className="border-y border-[#dce7f4] bg-[#f7fbff] py-16 sm:py-20"><div className="mx-auto grid max-w-[1000px] gap-8 px-4 sm:px-6 md:grid-cols-[.75fr_1.25fr]"><div><CircleHelp className="mb-4 size-8 text-[#1168e8]"/><h2 className="text-3xl font-black tracking-[-.035em] text-[#10213a]">Частые вопросы</h2><p className="mt-3 text-sm leading-6 text-[#637389]">Не нашли ответ? Напишите в поддержку - поможем проверить совместимость и выбрать тариф.</p></div><div className="space-y-3">{items.map((i,n)=><details key={i.q} open={n===0} className="group rounded-2xl border border-[#dbe5ef] bg-white p-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold text-[#10213a]">{i.q}<ChevronDown className="size-5 shrink-0 transition-transform group-open:rotate-180"/></summary><p className="mt-3 pr-8 text-sm leading-6 text-[#637389]">{i.a}</p></details>)}</div></div></section>}
