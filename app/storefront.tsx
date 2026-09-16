"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, CircleHelp, Clock3, CreditCard, Globe2, Headphones, LoaderCircle, Menu, Minus, PackageCheck, Plus, Search, ShieldCheck, ShoppingBag, Smartphone, Sparkles, Star, Trash2, Truck, Wifi, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trackEvent, trackOnce, type AnalyticsItem } from "@/lib/analytics";
import { parseStoredCart, serializeCart } from "@/lib/cart-storage";
import { productDisplayOffer, productIsAvailable, variantIsAvailable, type Product, type ProductVariant } from "@/lib/catalog";
import type { PublicCategory } from "@/lib/categories";
const regions = ["Все направления", "Европа", "Азия", "Ближний Восток", "Америка"];
type OrderReceipt = { number: string; paymentMethod: "crypto" | "manager"; checkoutUrl?: string; managerNotified: boolean; customerNotified: boolean; value: number; currency: string; items: AnalyticsItem[] };
type CheckoutCustomer = { name: string; email: string; contact: string };
const cryptoPaymentEnabled = process.env.NEXT_PUBLIC_CRYPTO_PAYMENT_ENABLED === "true";
const CART_STORAGE_KEY = "simka-cart-v1";
type CartLine = { key: string; product: Product; variant: ProductVariant | null; quantity: number; price: number; currency: string; sku: string; data: string; days: number };

function variantIsPurchasable(variant: ProductVariant) { return variantIsAvailable(variant); }
function productIsPurchasable(product: Product) { return productIsAvailable(product); }
function defaultVariant(product: Product) { return productDisplayOffer(product).variant; }
function cartKey(productId: number, variantId: number | null) { return `${productId}:${variantId ?? 0}`; }
function analyticsItem(line: CartLine, quantity = line.quantity): AnalyticsItem {
  return { item_id: line.sku, item_name: line.product.name, item_category: line.product.type, item_variant: line.variant?.name, price: line.price, quantity };
}

export default function Storefront({categories=[],products,customer}:{categories?:PublicCategory[];products:Product[];customer?:CheckoutCustomer}) {
  const [query,setQuery]=useState(""); const [region,setRegion]=useState("Все направления"); const [type,setType]=useState("Все типы");
  const [cart,setCart]=useState<Record<string,number>>({}); const [cartOpen,setCartOpen]=useState(false); const [checkout,setCheckout]=useState(false); const [ordered,setOrdered]=useState<OrderReceipt|null>(null); const [mobileMenu,setMobileMenu]=useState(false);
  const cartHydrated=useRef(false);
  const visible=useMemo(()=>products.filter(p=>productIsPurchasable(p)&&`${p.name} ${p.country} ${p.operator} ${p.region} ${p.sku} ${p.variants.map(variant=>`${variant.name} ${variant.sku} ${variant.data||""}`).join(" ")}`.toLowerCase().includes(query.toLowerCase())&&(region==="Все направления"||p.region===region)&&(type==="Все типы"||p.type===type)),[products,query,region,type]);
  const cartItems=useMemo<CartLine[]>(()=>Object.entries(cart).flatMap(([key,quantity])=>{const [productId,variantId]=key.split(":").map(Number);const product=products.find(item=>item.id===productId);if(!product)return[];const variant=variantId?product.variants.find(item=>item.id===variantId)??null:null;return [{key,product,variant,quantity,price:variant?.price??product.price,currency:variant?.currency??product.currency,sku:variant?.sku??product.sku,data:variant?.data??product.data,days:variant?.days??product.days}]}),[cart,products]);
  const cartCount=cartItems.reduce((sum,line)=>sum+line.quantity,0); const total=cartItems.reduce((sum,line)=>sum+line.price*line.quantity,0); const cartCurrencies=[...new Set(cartItems.map(line=>line.currency))]; const cartCurrency=cartCurrencies[0]??"RUB"; const mixedCurrencies=cartCurrencies.length>1;
  const add=useCallback((id:number,variantId?:number)=>{const product=products.find(item=>item.id===id);if(!product||!productIsPurchasable(product))return;const selected=variantId?product.variants.find(item=>item.id===variantId&&variantIsPurchasable(item))??null:defaultVariant(product);if(product.variants.length&&!selected)return;const key=cartKey(id,selected?.id??null);const stock=selected?.stockQuantity??product.stockQuantity;const previous=cart[key]||0;const next=stock===null?previous+1:Math.min(stock,previous+1);setCart(current=>({...current,[key]:stock===null?((current[key]||0)+1):Math.min(stock,(current[key]||0)+1)}));if(next>previous){const line:CartLine={key,product,variant:selected,quantity:next-previous,price:selected?.price??product.price,currency:selected?.currency??product.currency,sku:selected?.sku??product.sku,data:selected?.data??product.data,days:selected?.days??product.days};trackEvent("add_to_cart",{currency:line.currency,value:line.price*(next-previous),items:[analyticsItem(line,next-previous)]})}},[cart,products]);
  const change=(key:string,amount:number)=>{const [productId,variantId]=key.split(":").map(Number);const product=products.find(item=>item.id===productId);const variant=variantId?product?.variants.find(item=>item.id===variantId):null;const stock=variant?.stockQuantity??product?.stockQuantity??null;const previous=cart[key]||0;const requested=Math.max(0,previous+amount);const next=stock===null?requested:Math.min(stock,requested);if(product&&next!==previous){const quantity=Math.abs(next-previous);const line:CartLine={key,product,variant:variant??null,quantity,price:variant?.price??product.price,currency:variant?.currency??product.currency,sku:variant?.sku??product.sku,data:variant?.data??product.data,days:variant?.days??product.days};trackEvent(amount>0?"add_to_cart":"remove_from_cart",{currency:line.currency,value:line.price*quantity,items:[analyticsItem(line,quantity)]})}setCart(current=>{const updated={...current,[key]:next};if(!next)delete updated[key];return updated})};

  useEffect(()=>{
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
    },0);
    return()=>window.clearTimeout(timer);
  },[products]);

  useEffect(()=>{
    if(!cartHydrated.current)return;
    try{
      if(Object.keys(cart).length)window.localStorage.setItem(CART_STORAGE_KEY,serializeCart(cart));
      else window.localStorage.removeItem(CART_STORAGE_KEY);
    }catch{/* Checkout still works when browser storage is unavailable. */}
  },[cart]);

  useEffect(()=>{
    if(!query&&region==="Все направления"&&type==="Все типы")return;
    const timer=window.setTimeout(()=>{
      if(query)trackEvent("search",{query_length:Math.min(query.length,100),results_count:visible.length,no_results:visible.length===0,search_location:"home"});
      if(region!=="Все направления"||type!=="Все типы")trackEvent("catalog_filter",{region:region==="Все направления"?"all":region,sim_type:type==="Все типы"?"all":type,results_count:visible.length,filter_location:"home"});
    },500);
    return()=>window.clearTimeout(timer);
  },[query,region,type,visible.length]);

  useEffect(()=>{
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
  },[products]);

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
    <div className="border-b border-[#dce7f4] bg-[#edf7ff] px-4 py-2 text-center text-[13px] font-medium text-[#164475]"><span className="inline-flex items-center gap-2"><Sparkles className="size-3.5 text-[#1679f2]"/>eSIM на email после оплаты · Помощь с выбором тарифа</span></div>
    <header className="sticky top-0 z-40 border-b border-border/80 bg-white/90 backdrop-blur-xl"><div className="mx-auto flex h-[72px] max-w-[1240px] items-center gap-8 px-4 sm:px-6">
      <a href="#top" className="flex shrink-0 items-center gap-2.5" aria-label="SIMKA — на главную"><Logo/><span className="text-[21px] font-black tracking-[-0.04em] text-[#10213a]">SIMKA</span></a>
      <nav className="hidden items-center gap-7 text-[14px] font-semibold text-[#42526a] lg:flex"><a className="hover:text-[#1168e8]" href="#catalog">Каталог</a><a className="hover:text-[#1168e8]" href="/categories">Категории</a><a className="hover:text-[#1168e8]" href="/countries">Страны</a><a className="hover:text-[#1168e8]" href="#faq">FAQ</a></nav>
      <div className="ml-auto hidden items-center gap-2 md:flex"><Button asChild variant="ghost" className="h-11 rounded-xl text-[#42526a]"><a href="/account">Кабинет</a></Button><Button asChild variant="ghost" className="h-11 rounded-xl text-[#42526a]"><a href="/contacts"><Headphones className="size-4" aria-hidden="true"/>Помощь</a></Button></div>
      <Cart open={cartOpen} onOpenChange={(open)=>{setCartOpen(open);if(open&&cartItems.length)trackEvent("view_cart",{currency:cartCurrency,value:total,items:cartItems.map((line)=>analyticsItem(line))})}} items={cartItems} count={cartCount} total={total} currency={cartCurrency} mixedCurrencies={mixedCurrencies} checkout={checkout} ordered={ordered} customer={customer} onChange={change} onCheckout={setCheckout} onBeginCheckout={()=>trackEvent("begin_checkout",{currency:cartCurrency,value:total,items:cartItems.map((line)=>analyticsItem(line))})} onOrder={(receipt)=>{trackOnce(`order-created:${receipt.number}`,"generate_lead",{transaction_id:receipt.number,currency:receipt.currency,value:receipt.value,items:receipt.items});setOrdered(receipt);setCart({});setCheckout(false)}}/>
      <button onClick={()=>setMobileMenu(!mobileMenu)} className="grid size-11 place-items-center rounded-xl border lg:hidden" aria-expanded={mobileMenu} aria-controls="mobile-navigation" aria-label={mobileMenu?"Закрыть меню":"Открыть меню"}>{mobileMenu?<X className="size-5"/>:<Menu className="size-5"/>}</button>
    </div>{mobileMenu&&<nav id="mobile-navigation" className="grid gap-1 border-t bg-white p-4 text-sm font-semibold lg:hidden">{[["Каталог","#catalog"],["Категории","/categories"],["Страны","/countries"],["Как это работает","#how"],["Доставка","/delivery"],["FAQ","#faq"],["Личный кабинет","/account"]].map(([label,href])=><a key={href} onClick={()=>setMobileMenu(false)} className="flex min-h-11 items-center rounded-lg px-3 hover:bg-muted" href={href}>{label}</a>)}</nav>}</header>

    <section id="top" className="relative overflow-hidden border-b border-[#dce7f4] bg-[#f7fbff]"><div className="absolute inset-0 sim-grid opacity-45"/><div className="relative mx-auto grid max-w-[1240px] items-center gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.1fr_.9fr] md:py-16"><div>
      <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#cfe1f5] bg-white px-3 py-1.5 text-xs font-bold text-[#28577f]"><Globe2 className="size-3.5 text-[#1168e8]"/>SIM и eSIM для путешествий</div>
      <h1 className="max-w-[720px] text-[clamp(38px,5.2vw,68px)] font-black leading-[.98] tracking-[-0.055em] text-[#10213a]">eSIM и SIM<br/><span className="text-[#1168e8]">для путешествий</span></h1>
      <p className="mt-5 max-w-[570px] text-base leading-7 text-[#56667c] sm:text-lg">Выберите страну, получите eSIM с инструкцией после оплаты или закажите физическую SIM с доставкой.</p>
      <div className="mt-7 flex max-w-[680px] flex-col gap-3 rounded-2xl border border-[#cbdced] bg-white p-2.5 shadow-[0_16px_50px_rgba(29,72,121,.12)] sm:flex-row"><SearchBox value={query} onChange={setQuery}/><Button onClick={()=>document.querySelector("#catalog")?.scrollIntoView({behavior:"smooth"})} className="h-12 rounded-xl bg-[#1168e8] px-7 text-base font-bold hover:bg-[#0d56c3]">Найти тариф<ArrowRight className="size-4"/></Button></div>
      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[13px] font-medium text-[#51647a]">{["Цена и условия до заказа","Инструкция по активации","Поддержка на русском"].map(t=><span key={t} className="flex items-center gap-1.5"><Check className="size-4 text-[#68a71a]"/>{t}</span>)}</div>
    </div><HeroCards/></div></section>

    {categories.length>0&&<section id="categories" className="border-b border-[#dce7f4] bg-white"><div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6 sm:py-12"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="mb-2 text-xs font-black uppercase tracking-[.16em] text-[#1168e8]">Категории</p><h2 className="text-2xl font-black tracking-[-.03em] text-[#10213a] sm:text-3xl">Подборки тарифов</h2></div><a href="/categories" className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl px-3 font-bold text-[#1168e8] hover:bg-[#edf5ff]">Все категории <ArrowRight className="size-4" aria-hidden="true"/></a></div><div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{categories.map(category=><a key={category.id} href={`/category/${category.slug}`} className="group rounded-2xl border border-[#dbe5ef] bg-[#f8fbfe] p-5 transition hover:border-[#9fc5f4] hover:bg-white hover:shadow-[0_14px_35px_rgba(23,58,96,.08)]"><div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-black text-[#10213a] group-hover:text-[#1168e8]">{category.name}</h3><p className="mt-2 line-clamp-2 text-sm leading-6 text-[#637389]">{category.description||"Подборка доступных тарифов SIMKA."}</p></div><ArrowRight className="mt-1 size-5 shrink-0 text-[#1168e8]" aria-hidden="true"/></div><p className="mt-4 text-xs font-bold uppercase tracking-wide text-[#7a899a]">{category.productIds.length} {productWord(category.productIds.length)}</p></a>)}</div></div></section>}

    <section id="catalog" className="mx-auto max-w-[1240px] px-4 py-14 sm:px-6 sm:py-20"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="mb-2 text-xs font-black uppercase tracking-[.16em] text-[#1168e8]">Популярные направления</p><h2 className="text-3xl font-black tracking-[-.035em] text-[#10213a] sm:text-4xl">Выберите свой тариф</h2></div><p className="max-w-[390px] text-sm leading-6 text-[#637389]">Сравните опубликованные предложения операторов. Цена и наличие проверяются при создании заказа.</p></div>
      <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-[#dbe5ef] bg-[#f8fbfe] p-3 sm:flex-row"><div className="relative flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#7890a8]" aria-hidden="true"/><Input value={query} onChange={e=>setQuery(e.target.value)} aria-label="Поиск тарифов" className="h-11 rounded-xl border-[#dbe5ef] bg-white pl-10 shadow-none" placeholder="Страна или оператор"/></div><Filter label="Регион" value={region} onChange={setRegion} values={regions}/><Filter label="Тип SIM" value={type} onChange={setType} values={["Все типы","eSIM","SIM"]} narrow/></div>
      {visible.length?<div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visible.map(p=><ProductCard key={p.id} product={p} count={cartItems.filter(line=>line.product.id===p.id).reduce((sum,line)=>sum+line.quantity,0)} onAdd={()=>add(p.id)}/>)}</div>:<div className="mt-6 rounded-2xl border border-dashed py-16 text-center"><Search className="mx-auto mb-3 size-7 text-muted-foreground"/><h3 className="font-bold">Тарифы не найдены</h3><p className="mt-1 text-sm text-muted-foreground">Попробуйте изменить страну или тип SIM.</p></div>}
    </section>

    <section id="how" className="bg-[#10213a] py-16 text-white sm:py-20"><div className="mx-auto max-w-[1240px] px-4 sm:px-6"><div className="grid gap-10 lg:grid-cols-[.75fr_1.25fr]"><div><p className="mb-3 text-xs font-black uppercase tracking-[.16em] text-[#b7f34a]">Без лишних шагов</p><h2 className="text-3xl font-black tracking-[-.035em] sm:text-4xl">Связь уже ждёт вас в поездке</h2><p className="mt-4 text-sm leading-6 text-[#aebed2]">Для eSIM не нужна доставка: QR-код и инструкция приходят после подтверждения оплаты.</p></div><div className="grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-3">{[{icon:Globe2,n:"01",title:"Выберите страну",text:"Найдите тариф по объёму интернета и сроку."},{icon:CreditCard,n:"02",title:"Оформите заказ",text:"Получите актуальные реквизиты от менеджера на email."},{icon:Wifi,n:"03",title:"Подключитесь",text:"Установите eSIM по инструкции и выходите в сеть."}].map(s=><div key={s.n} className="bg-[#142944] p-6"><div className="flex items-center justify-between"><span className="grid size-11 place-items-center rounded-xl bg-[#b7f34a] text-[#10213a]"><s.icon className="size-5"/></span><span className="font-mono text-xs text-white/35">{s.n}</span></div><h3 className="mt-8 text-lg font-bold">{s.title}</h3><p className="mt-2 text-sm leading-6 text-[#aebed2]">{s.text}</p></div>)}</div></div></div></section>

    <section id="delivery" className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 sm:py-20"><div className="grid gap-5 md:grid-cols-3"><Feature icon={ShieldCheck} title="Понятные условия" text="До заказа видны срок действия, объём трафика, цена и доступность."/><Feature icon={PackageCheck} title="eSIM на email после оплаты" text="После подтверждения оплаты вы получите код активации и инструкцию."/><Feature icon={Truck} title="Доставка SIM по согласованию" text="Адрес, срок и стоимость доставки физической SIM менеджер подтвердит при оформлении."/></div></section>
    <Faq/>
    <Footer/>
  </main>;
}

function Logo(){return <span className="grid size-10 place-items-center rounded-[13px] bg-[#1168e8] text-white shadow-[0_7px_18px_rgba(17,104,232,.25)]"><Wifi className="size-5"/></span>}
function SearchBox({value,onChange}:{value:string;onChange:(v:string)=>void}){return <div className="relative flex-1"><Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[#7090b1]" aria-hidden="true"/><Input value={value} onChange={e=>onChange(e.target.value)} className="h-12 border-0 bg-transparent pl-12 text-base shadow-none focus-visible:ring-3" placeholder="Куда вы едете?" aria-label="Поиск по странам и операторам"/></div>}
function Filter({label,value,onChange,values,narrow=false}:{label:string;value:string;onChange:(v:string)=>void;values:string[];narrow?:boolean}){return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className={`h-11 w-full rounded-xl border-[#dbe5ef] bg-white ${narrow?"sm:w-[150px]":"sm:w-[200px]"}`}><SelectValue/></SelectTrigger><SelectContent>{values.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select>}
function HeroCards(){return <div className="relative mx-auto hidden h-[370px] w-full max-w-[450px] md:block" aria-hidden="true"><MiniSim className="absolute left-4 top-10 rotate-[-8deg] bg-[#10213a] text-white" flag="🇹🇷" country="ТУРЦИЯ" data="20 ГБ" days="30 дней" operator="Turkcell"/><MiniSim className="absolute bottom-4 right-0 rotate-[7deg] bg-[#b7f34a] text-[#10213a]" flag="🇹🇭" country="ТАИЛАНД" data="∞ ГБ" days="15 дней" operator="AIS" light/><span className="absolute right-1 top-2 grid size-20 place-items-center rounded-full bg-white text-center text-[11px] font-black uppercase leading-4 text-[#1168e8] shadow-xl">готово<br/>к поездке</span></div>}
function MiniSim({className,flag,country,data,days,operator,light=false}:{className:string;flag:string;country:string;data:string;days:string;operator:string;light?:boolean}){return <div className={`${className} w-[270px] rounded-[30px] p-5 shadow-2xl`}><div className="flex items-start justify-between"><span className="grid size-11 place-items-center rounded-xl bg-white/10"><Wifi/></span><span className="text-4xl">{flag}</span></div><p className={`mt-14 text-sm ${light?"text-[#10213a]/60":"text-white/60"}`}>{country} · eSIM</p><p className="mt-1 text-3xl font-black">{data}</p><div className={`mt-6 flex justify-between border-t pt-4 text-sm ${light?"border-[#10213a]/15":"border-white/15"}`}><span>{days}</span><span>{operator}</span></div></div>}

function Cart({open,onOpenChange,items,count,total,currency,mixedCurrencies,checkout,ordered,customer,onChange,onCheckout,onBeginCheckout,onOrder}:{open:boolean;onOpenChange:(open:boolean)=>void;items:CartLine[];count:number;total:number;currency:string;mixedCurrencies:boolean;checkout:boolean;ordered:OrderReceipt|null;customer?:CheckoutCustomer;onChange:(key:string,n:number)=>void;onCheckout:(v:boolean)=>void;onBeginCheckout:()=>void;onOrder:(receipt:OrderReceipt)=>void}){return <Sheet open={open} onOpenChange={onOpenChange}><SheetTrigger asChild><Button className="relative h-11 rounded-xl bg-[#10213a] px-4 hover:bg-[#1b3456]"><ShoppingBag className="size-[18px]" aria-hidden="true"/><span className="hidden sm:inline">Корзина</span>{count>0&&<span aria-live="polite" className="absolute -right-2 -top-2 grid size-5 place-items-center rounded-full bg-[#b7f34a] text-[11px] font-black text-[#10213a]">{count}</span>}</Button></SheetTrigger><SheetContent className="w-full border-l-[#dce5f0] bg-white p-0 sm:max-w-[470px]"><SheetHeader className="border-b border-border px-6 py-5"><SheetTitle className="text-xl">Ваша корзина</SheetTitle><SheetDescription>{count?`${count} ${productWord(count)}`:"Пока здесь пусто"}</SheetDescription></SheetHeader>{ordered?<OrderDone receipt={ordered}/>:checkout?<Checkout items={items} total={total} currency={currency} customer={customer} onBack={()=>onCheckout(false)} onOrder={onOrder}/>:items.length?<CartList items={items} total={total} currency={currency} mixedCurrencies={mixedCurrencies} onChange={onChange} onCheckout={()=>{onBeginCheckout();onCheckout(true)}}/>:<div className="flex flex-1 flex-col items-center justify-center px-8 text-center"><span className="mb-4 grid size-16 place-items-center rounded-full bg-[#edf5ff] text-[#1168e8]"><ShoppingBag className="size-7"/></span><h3 className="text-xl font-bold text-[#10213a]">Выберите подходящую SIM</h3><p className="mt-2 text-sm text-muted-foreground">Добавленные тарифы появятся здесь.</p></div>}</SheetContent></Sheet>}
function OrderDone({receipt}:{receipt:OrderReceipt}){return <div className="flex flex-1 flex-col items-center justify-center px-8 text-center"><span className="mb-5 grid size-16 place-items-center rounded-full bg-[#e8fbd0] text-[#4b8012]"><Check className="size-8"/></span><h3 className="text-2xl font-bold text-[#10213a]">Заказ создан</h3><p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">Номер заказа <strong className="text-[#10213a]">{receipt.number}</strong>. Сохраните его.</p>{receipt.paymentMethod==="crypto"?<><p className="mt-4 max-w-xs rounded-xl bg-[#edf7ff] p-3 text-sm leading-6 text-[#28577f]">Оплата считается подтверждённой только после защищённого уведомления от платёжного провайдера. Простого возврата на сайт недостаточно.</p>{receipt.checkoutUrl&&<Button asChild className="mt-4 h-12 rounded-xl bg-[#1168e8] px-6 hover:bg-[#0d56c3]"><a href={receipt.checkoutUrl}>Перейти к оплате</a></Button>}</>:<p className={`mt-4 max-w-xs rounded-xl p-3 text-sm leading-6 ${receipt.managerNotified?"bg-[#edf7ff] text-[#28577f]":"bg-amber-50 text-amber-800"}`}>{receipt.managerNotified?`Менеджер получил заказ. Реквизиты для оплаты придут на email, указанный при оформлении.${receipt.customerNotified?" Подтверждение заказа уже отправлено.":" Сохраните номер выше: автоматическое письмо-подтверждение сейчас не доставлено."} После оплаты менеджер подтвердит платёж и начнёт выдачу eSIM или отправку SIM.`:"Заказ сохранён, но уведомление менеджеру временно не доставлено. Сообщите номер заказа через раздел «Контакты»."}</p>}</div>}
function Checkout({items,total,currency,customer,onBack,onOrder}:{items:CartLine[];total:number;currency:string;customer?:CheckoutCustomer;onBack:()=>void;onOrder:(receipt:OrderReceipt)=>void}){
  const [loading,setLoading]=useState(false);const [error,setError]=useState("");
  const requestId=useRef(crypto.randomUUID());
  const physicalProducts=useMemo(()=>[...new Map(items.filter(line=>line.product.type==="SIM").map(line=>[line.product.id,line.product])).values()],[items]);
  const [deliveryChoices,setDeliveryChoices]=useState<Record<number,string>>(()=>Object.fromEntries(physicalProducts.map(product=>[product.id,product.deliveryOptions[0]?.id??""])));
  const chosenDelivery=physicalProducts.map(product=>product.deliveryOptions.find(option=>option.id===deliveryChoices[product.id])??null);
  const missingDelivery=chosenDelivery.some(option=>!option);
  const deliveryCurrencyMismatch=chosenDelivery.some(option=>Boolean(option&&option.cost!==null&&option.currency!==currency));
  const deliveryTotal=chosenDelivery.reduce((sum,option)=>sum+(option?.currency===currency?option.cost??0:0),0);
  const deliveryRequiresConfirmation=chosenDelivery.some(option=>Boolean(option&&(option.cost===null||option.regions.length>0)));
  const finalTotal=total+deliveryTotal;

  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setLoading(true);setError("");const form=new FormData(event.currentTarget);
    trackEvent("add_payment_info",{payment_type:String(form.get("paymentMethod")||"manager"),currency,value:finalTotal,items:items.map((line)=>analyticsItem(line))});
    try{
      const query=typeof window!=="undefined"?new URLSearchParams(window.location.search):null;
      const analytics=query?{source:query.get("utm_source")||undefined,medium:query.get("utm_medium")||undefined,campaign:query.get("utm_campaign")||undefined,content:query.get("utm_content")||undefined,term:query.get("utm_term")||undefined}:undefined;
      const response=await fetch("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:requestId.current,customerName:form.get("customerName"),customerEmail:form.get("customerEmail"),customerContact:form.get("customerContact"),deliveryAddress:form.get("deliveryAddress")||undefined,customerComment:form.get("customerComment"),paymentMethod:form.get("paymentMethod"),analytics,items:items.map(line=>({productId:line.product.id,variantId:line.variant?.id,quantity:line.quantity})),deliverySelections:physicalProducts.map(product=>({productId:product.id,optionId:deliveryChoices[product.id]}))})});
      const data=await response.json() as {error?:string;order?:{orderNumber?:string;paymentMethod?:"crypto"|"manager";checkoutUrl?:string;managerNotified?:boolean;customerNotified?:boolean;totalAmount?:number;currency?:string}};
      if(!response.ok||!data.order?.orderNumber)throw new Error(data.error||"Не удалось создать заказ");
      onOrder({number:data.order.orderNumber,paymentMethod:data.order.paymentMethod??(form.get("paymentMethod")==="crypto"?"crypto":"manager"),checkoutUrl:data.order.checkoutUrl,managerNotified:data.order.managerNotified===true,customerNotified:data.order.customerNotified===true,value:typeof data.order.totalAmount === "number" ? data.order.totalAmount : total,currency:data.order.currency || currency,items:items.map((line)=>analyticsItem(line))});
    }catch(reason){trackEvent("checkout_error",{error_type:reason instanceof Error?reason.name:"UnknownError"});setError(reason instanceof Error?reason.message:"Не удалось создать заказ")}finally{setLoading(false)}
  }

  return <form className="flex flex-1 flex-col overflow-y-auto p-6" onSubmit={submit}>
    <button type="button" onClick={onBack} className="mb-5 min-h-11 w-fit text-sm font-semibold text-[#1168e8]">← Вернуться в корзину</button><h3 className="mb-5 text-xl font-bold text-[#10213a]">Оформление заказа</h3>
    {error&&<div role="alert" tabIndex={-1} className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="space-y-4">{customer&&<p className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">Данные подставлены из вашего профиля. Их можно изменить для этого заказа.</p>}<FormField name="customerName" label="Имя" placeholder="Как к вам обращаться" autoComplete="name" defaultValue={customer?.name}/><FormField name="customerEmail" label="Email для получения реквизитов" placeholder="mail@example.com" email autoComplete="email" defaultValue={customer?.email}/><p className="-mt-2 text-xs leading-5 text-muted-foreground">Менеджер отправит реквизиты для оплаты на этот email. {!customer&&<a href="/account/login?returnTo=/" className="font-bold text-[#1168e8] hover:underline">Войти в кабинет</a>}</p><FormField name="customerContact" label="Telegram или телефон" placeholder="@username" optional autoComplete="tel" defaultValue={customer?.contact}/>
      {physicalProducts.length>0&&<><FormField name="deliveryAddress" label="Адрес доставки" placeholder="Город, улица, дом, квартира" autoComplete="street-address" maxLength={500}/><fieldset className="space-y-3"><legend className="text-sm font-semibold">Доставка физической SIM</legend>{physicalProducts.map(product=><label key={product.id} className="block rounded-xl border border-[#dbe5ef] bg-[#f8fbfe] p-3 text-sm"><span className="mb-2 block font-bold text-[#10213a]">{product.name}</span>{product.deliveryOptions.length?<select required value={deliveryChoices[product.id]??""} onChange={event=>setDeliveryChoices(current=>({...current,[product.id]:event.target.value}))} className="h-11 w-full rounded-lg border border-input bg-white px-3"><option value="" disabled>Выберите способ</option>{product.deliveryOptions.map(option=><option key={option.id} value={option.id}>{option.label} · {option.cost===null?"стоимость уточнит менеджер":formatPrice(option.cost,option.currency)}{option.regions.length?" · регион проверит менеджер":""}</option>)}</select>:<span role="alert" className="text-red-700">Для товара пока не настроен способ доставки.</span>}</label>)}</fieldset></>}
      <label className="block text-sm font-semibold" htmlFor="customerComment">Комментарий<span className="font-normal text-muted-foreground"> — необязательно</span><textarea id="customerComment" name="customerComment" maxLength={1000} className="mt-2 min-h-20 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" placeholder="Например, удобное время для связи"/></label>
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Способ оплаты</legend><label className={`flex min-h-12 items-center gap-3 rounded-xl border p-4 text-sm ${cryptoPaymentEnabled&&!deliveryRequiresConfirmation?"cursor-pointer border-[#dbe5ef] bg-white text-[#10213a]":"bg-[#f7f8fa] text-[#7a899a]"}`}><input disabled={!cryptoPaymentEnabled||deliveryRequiresConfirmation} name="paymentMethod" value="crypto" type="radio"/><span><strong className="block">Криптовалюта{!cryptoPaymentEnabled?" — скоро":""}</strong>{cryptoPaymentEnabled&&<span className="mt-1 block text-xs text-[#637389]">Переход на защищённую страницу провайдера</span>}</span></label><label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-[#1168e8] bg-[#f4f9ff] p-4 text-sm"><input defaultChecked name="paymentMethod" value="manager" type="radio"/><span><strong className="block text-[#10213a]">По реквизитам через менеджера</strong><span className="mt-1 block text-xs text-[#637389]">Реквизиты придут на указанный email</span></span></label></fieldset>
    </div>
    {deliveryTotal>0&&<p className="mt-5 flex justify-between text-sm text-[#52657a]"><span>Доставка</span><strong>{formatPrice(deliveryTotal,currency)}</strong></p>}
    {deliveryRequiresConfirmation&&<p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">Сумма предварительная. Менеджер проверит доступность доставки для вашего адреса и подтвердит итог до отправки реквизитов.</p>}
    {deliveryCurrencyMismatch&&<p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-800">Выбранная доставка указана в другой валюте. Выберите другой вариант или оформите товары отдельно.</p>}
    <Button disabled={loading||missingDelivery||deliveryCurrencyMismatch} type="submit" className="mt-6 h-12 rounded-xl bg-[#1168e8] text-base hover:bg-[#0d56c3]">{loading?<><LoaderCircle className="animate-spin"/>Создаём заказ…</>:<>Создать заказ · {deliveryRequiresConfirmation?"предварительно ":""}{formatPrice(finalTotal,currency)}</>}</Button><p className="mt-3 text-center text-xs leading-5 text-muted-foreground">Нажимая кнопку, вы соглашаетесь с <a className="underline hover:text-[#1168e8]" href="/terms">условиями использования</a> и <a className="underline hover:text-[#1168e8]" href="/privacy">политикой конфиденциальности</a>.</p>
  </form>
}
function FormField({name,label,placeholder,email=false,optional=false,autoComplete,maxLength,defaultValue}:{name:string;label:string;placeholder:string;email?:boolean;optional?:boolean;autoComplete:string;maxLength?:number;defaultValue?:string}){return <label className="block text-sm font-semibold" htmlFor={name}>{label}{optional&&<span className="font-normal text-muted-foreground"> — необязательно</span>}<Input id={name} name={name} required={!optional} type={email?"email":"text"} autoComplete={autoComplete} maxLength={maxLength??(email?254:100)} defaultValue={defaultValue} className="mt-2 h-11 rounded-xl" placeholder={placeholder}/></label>}
function CartList({items,total,currency,mixedCurrencies,onChange,onCheckout}:{items:CartLine[];total:number;currency:string;mixedCurrencies:boolean;onChange:(key:string,n:number)=>void;onCheckout:()=>void}){return <div className="flex flex-1 flex-col overflow-hidden"><div className="flex-1 space-y-3 overflow-y-auto p-6">{items.map(line=><div key={line.key} className="flex gap-4 rounded-2xl border border-border bg-[#f9fbfd] p-4"><span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-xl bg-white text-2xl shadow-sm">{line.product.flag}</span><div className="min-w-0 flex-1"><p className="font-bold text-[#10213a]">{line.product.country} · {line.data}</p><p className="mt-1 text-xs text-muted-foreground">{line.variant?.name??line.product.type} · {line.days} дней · {line.sku}</p><div className="mt-3 flex items-center gap-2"><Qty label="Уменьшить количество" onClick={()=>onChange(line.key,-1)}><Minus/></Qty><span className="w-5 text-center text-sm font-bold">{line.quantity}</span><Qty label="Увеличить количество" onClick={()=>onChange(line.key,1)}><Plus/></Qty></div></div><div className="text-right"><p className="font-bold">{formatPrice(line.price*line.quantity,line.currency)}</p><button onClick={()=>onChange(line.key,-line.quantity)} aria-label={`Удалить ${line.product.name}`} className="mt-2 grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4"/></button></div></div>)}</div><div className="border-t bg-white p-6"><div className="mb-4 flex justify-between text-lg font-bold"><span>Стоимость товаров</span><span>{mixedCurrencies?"—":formatPrice(total,currency)}</span></div>{mixedCurrencies&&<p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Товары в разных валютах нужно оформить отдельными заказами.</p>}<Button disabled={mixedCurrencies} onClick={onCheckout} className="h-12 w-full rounded-xl bg-[#1168e8] text-base hover:bg-[#0d56c3]">Перейти к оформлению<ArrowRight/></Button><div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-[#439313]"/>Цена и наличие проверяются перед оплатой</div></div></div>}
function Qty({onClick,children,label}:{onClick:()=>void;children:React.ReactNode;label:string}){return <button onClick={onClick} aria-label={label} className="grid size-11 place-items-center rounded-lg border bg-white [&_svg]:size-4">{children}</button>}

function ProductCard({product,count,onAdd}:{product:Product;count:number;onAdd:()=>void}){
  const {price:displayedPrice,currency:displayedCurrency}=productDisplayOffer(product);
  return <article className="group overflow-hidden rounded-[22px] border border-[#dce5ee] bg-white transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_45px_rgba(23,58,96,.12)]">
    <div className={`relative h-[128px] bg-gradient-to-br ${product.tone} p-5 text-white`}><div className="flex items-start justify-between"><span className="rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider backdrop-blur">{product.type}</span><span role="img" aria-label={`Флаг страны ${product.country}`} className="text-3xl drop-shadow">{product.flag}</span></div>{product.popular&&<span className="absolute bottom-4 left-5 flex items-center gap-1 rounded-full bg-[#b7f34a] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-[#10213a]"><Star className="size-3 fill-current"/>Популярный</span>}<span className="absolute bottom-4 right-5 text-xs font-semibold text-white/70">{product.operator}</span></div>
    <div className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-[#7a899a]">{product.region} · {product.country}</p><h3 className="mt-1 text-xl font-black tracking-tight text-[#10213a]"><a href={`/product/${encodeURIComponent(product.slug)}`} className="rounded-sm hover:text-[#1168e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1168e8]">{product.name}</a></h3></div><div className="shrink-0 text-right"><p className="text-xl font-black text-[#10213a]">{formatPrice(displayedPrice,displayedCurrency)}</p>{product.oldPrice&&displayedCurrency===product.currency&&product.oldPrice>displayedPrice&&<p className="text-xs text-muted-foreground line-through">{formatPrice(product.oldPrice,product.currency)}</p>}</div></div>
      <div className="mt-5 grid grid-cols-2 gap-2"><Spec icon={Wifi} label="Интернет" value={product.data}/><Spec icon={Clock3} label="Срок" value={`${product.days} дней`}/>{product.calls&&<Spec icon={Smartphone} label="Звонки" value={product.calls}/>}<Spec icon={Globe2} label="Активация" value="По инструкции"/></div>
      <div className="mt-5 grid grid-cols-[auto_1fr] gap-2"><a href={`/product/${encodeURIComponent(product.slug)}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#cddbea] px-3 text-sm font-bold text-[#28577f] hover:bg-[#edf5ff]">Подробнее</a><Button onClick={onAdd} className="h-11 rounded-xl bg-[#10213a] px-3 font-bold hover:bg-[#1168e8]">{count?<><Check className="size-4"/>В корзине · {count}</>:<>В корзину<Plus className="size-4"/></>}</Button></div>
    </div>
  </article>
}
function Spec({icon:Icon,label,value}:{icon:typeof Wifi;label:string;value:string}){return <div className="rounded-xl bg-[#f5f8fb] p-3"><div className="flex items-center gap-1.5 text-[11px] text-[#7a899a]"><Icon className="size-3.5"/>{label}</div><p className="mt-1 text-sm font-bold text-[#283b54]">{value}</p></div>}
function Feature({icon:Icon,title,text}:{icon:typeof Wifi;title:string;text:string}){return <div className="rounded-2xl border border-[#dbe5ef] p-6"><span className="grid size-11 place-items-center rounded-xl bg-[#e9f3ff] text-[#1168e8]"><Icon className="size-5"/></span><h3 className="mt-5 text-lg font-bold text-[#10213a]">{title}</h3><p className="mt-2 text-sm leading-6 text-[#637389]">{text}</p></div>}
function Faq(){const items=[{q:"Как проверить, поддерживает ли телефон eSIM?",a:"В настройках устройства найдите пункт «Добавить eSIM» или «Добавить сотовый тариф». Перед покупкой также проверьте модель в списке совместимых устройств."},{q:"Когда начинается срок действия тарифа?",a:"Условия зависят от оператора. Точное правило начала срока действия указано в карточке конкретного тарифа."},{q:"Можно ли раздать интернет?",a:"Возможность раздачи зависит от тарифа и правил оператора. Проверьте характеристики выбранного предложения или уточните это у менеджера до оплаты."}];return <section id="faq" className="border-y border-[#dce7f4] bg-[#f7fbff] py-16 sm:py-20"><div className="mx-auto grid max-w-[1000px] gap-8 px-4 sm:px-6 md:grid-cols-[.75fr_1.25fr]"><div><CircleHelp className="mb-4 size-8 text-[#1168e8]"/><h2 className="text-3xl font-black tracking-[-.035em] text-[#10213a]">Частые вопросы</h2><p className="mt-3 text-sm leading-6 text-[#637389]">Не нашли ответ? Напишите в поддержку — поможем проверить совместимость и выбрать тариф.</p></div><div className="space-y-3">{items.map((i,n)=><details key={i.q} open={n===0} className="group rounded-2xl border border-[#dbe5ef] bg-white p-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold text-[#10213a]">{i.q}<ChevronDown className="size-5 shrink-0 transition-transform group-open:rotate-180"/></summary><p className="mt-3 pr-8 text-sm leading-6 text-[#637389]">{i.a}</p></details>)}</div></div></section>}
function Footer(){return <footer className="bg-white"><div className="mx-auto max-w-[1240px] px-4 py-12 sm:px-6"><div className="grid gap-10 border-b border-border pb-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]"><div><div className="flex items-center gap-2.5"><Logo/><span className="text-xl font-black tracking-[-.04em] text-[#10213a]">SIMKA</span></div><p className="mt-4 max-w-xs text-sm leading-6 text-[#637389]">SIM и eSIM для путешествий. Оставайтесь на связи в поездке.</p></div><FooterColumn title="Покупателям" links={["Каталог","Личный кабинет","Оплата","Доставка","Возврат"]}/><FooterColumn title="О компании" links={["О нас","Контакты","Поддержка","Партнёрам"]}/><FooterColumn title="Документы" links={["Конфиденциальность","Условия","Cookie"]}/></div><div className="flex flex-col gap-3 pt-6 text-xs text-[#7a899a] sm:flex-row sm:items-center sm:justify-between"><span>© 2026 SIMKA. Все права защищены.</span><span>Валюта указана в карточке товара</span></div></div></footer>}
function FooterColumn({title,links}:{title:string;links:string[]}){const routes:Record<string,string>={"Каталог":"/catalog","Личный кабинет":"/account","Оплата":"/payment","Доставка":"/delivery","Возврат":"/returns","О нас":"/about","Контакты":"/contacts","Поддержка":"/contacts","Конфиденциальность":"/privacy","Условия":"/terms","Cookie":"/cookies","Партнёрам":"/contacts"};return <div><h3 className="text-sm font-bold text-[#10213a]">{title}</h3><ul className="mt-4 space-y-3 text-sm text-[#637389]">{links.map(l=><li key={l}><a href={routes[l]??"/#catalog"} className="hover:text-[#1168e8]">{l}</a></li>)}</ul></div>}
function formatPrice(value:number,currency="RUB"){try{return new Intl.NumberFormat("ru-RU",{style:"currency",currency,maximumFractionDigits:0}).format(value)}catch{return `${new Intl.NumberFormat("ru-RU").format(value)} ${currency}`}}
function productWord(count:number){const mod100=count%100,mod10=count%10;if(mod100>=11&&mod100<=14)return "товаров";if(mod10===1)return "товар";if(mod10>=2&&mod10<=4)return "товара";return "товаров"}
