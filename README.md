# Takip Defteri

Kendi Instagram arşivlerinden gönderdiğin takip isteklerini ve zaman içindeki değişimlerini görebileceğin Türkçe, tek kullanıcılı bir panel. Next.js App Router, TypeScript ve Tailwind CSS ile çalışır. Oturum ve kalıcı arşiv kayıtları Supabase Auth ve PostgreSQL üzerindedir.

## Instagram API kapsamı

Meta, [Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/) akışını işletme ve içerik üreticisi hesapları için sunar. Bu akışın temel hesap izni `instagram_business_basic` kullanır. [Facebook Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/) akışı, Facebook Sayfasına bağlı işletme ve içerik üreticisi hesaplarını kapsar ve temel Instagram hesap izni `instagram_basic` kullanır. Kişisel hesaplar bu iki profesyonel API akışının kapsamı dışındadır.

| Gereken liste | API ile desteklenen hesap türü | Liste için Meta izni | Resmî kaynak |
| --- | --- | --- | --- |
| Benim gönderdiğim bekleyen takip istekleri | Hiçbiri | Yayımlanmış liste izni veya uç noktası yok | [Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/), [Facebook Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/), [Meta Instagram API koleksiyonu](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) |
| Benim takip ettiğim hesapların kullanıcı adları | Hiçbiri | Yayımlanmış liste izni veya uç noktası yok | [IG User alan ve bağlantı referansı](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/), [Meta'nın IGUser şeması](https://github.com/meta/facebook-python-business-sdk/blob/27.0.1/facebook_business/adobjects/iguser.py) |

Meta'nın resmî SDK şemasındaki `followers_count` takipçi sayısını, `follows_count` hesabın takip ettiği hesap sayısını verir. Her iki alan da tamsayıdır. Şemada bu iki listenin kullanıcı adlarını döndüren bir bağlantı bulunmaz. [Resmî SDK alan tipleri](https://github.com/meta/facebook-python-business-sdk/blob/27.0.1/facebook_business/adobjects/iguser.py#L2043-L2044)

Bu geliştirme ortamında Meta belge ve Postman alan adlarına doğrudan erişim ağ vekili tarafından 403 ile engellendi. Kontrol, erişilebilen resmî Meta SDK sürümündeki alanlar ve bağlantılar ile Meta'nın resmî örneği üzerinden yapıldı. [SDK sürümü](https://github.com/meta/facebook-python-business-sdk/releases/tag/27.0.1) · [Facebook Sayfası bağlantısını gösteren Meta örneği](https://github.com/fbsamples/original-coast-clothing-ig#prerequisites)

Panelin veri kaynağı, ilgili JSON listelerini içeren Instagram veri dışa aktarımıdır. Panel her tamamlanan yüklemeden sonra analizi günceller ve son arşivin tarihini gösterir. Bu iş akışı Vercel Hobby üzerinde zamanlanmış görev gerektirmeden çalışır. [Instagram bilgilerini dışa aktarma](https://help.instagram.com/181231772500920)

## Supabase ve tek kullanıcı hesabı

1. Bir Supabase projesi oluştur. SQL Editor'da `supabase/migrations/` dizinindeki SQL dosyalarını ad sırasıyla uygula. Migration'lar arşiv tablolarını ve yalnızca izinli kullanıcıya erişim veren Row Level Security (RLS) kurallarını oluşturur.
2. Supabase **Authentication → Users** alanında kendi e-posta adresin ve parolanla bir kullanıcı oluştur. Yönetim panelinden eklerken bu tek kullanıcıyı doğrulanmış olarak oluşturabilirsin. Kullanıcının **User UID** değerini kopyala.
3. Aşağıdaki sorguyu SQL Editor'da çalıştır. Yer tutucuyu önce kendi Auth kullanıcı UUID'nle değiştir.

   ```sql
   insert into private.app_owner (user_id)
   values ('BURAYA_AUTH_KULLANICI_UUID')
   on conflict (singleton) do update
   set user_id = excluded.user_id;
   ```

4. **Authentication** ayarlarında e-posta sağlayıcısını açık tut ve **Allow new users to sign up** ayarını kapat. Uygulamanın giriş ekranı, oluşturduğun e-posta ve parolayla oturum açar. Veritabanı erişiminde belirleyici olan kayıt, `private.app_owner` tablosundaki tek Auth UUID'sidir.
5. **Connect** panelinden veya proje API ayarlarından Project URL ve Publishable key değerlerini al. Sunucuda da kullanıcı oturumu kullanılır. Yönetici anahtarına gerek yoktur. [Supabase parola ile giriş](https://supabase.com/docs/guides/auth/passwords) · [Supabase API anahtarları](https://supabase.com/docs/guides/api/api-keys)

## Yerelde çalıştırma

Node.js 24 ve npm ile proje kökünde çalıştır.

```bash
npm ci
cp .env.example .env.local
```

`.env.local` dosyasında `NEXT_PUBLIC_SUPABASE_URL` ve `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` değerlerini doldur.

```bash
npm run dev
```

Tarayıcıda `http://localhost:3000` adresini aç ve Supabase'de oluşturduğun hesabınla giriş yap.

## Arşiv yükleme ve sonuçlar

1. Instagram **Hesaplar Merkezi → Bilgilerin ve izinlerin → Bilgilerini dışa aktar** bölümünden doğru Instagram profilini seç. Bağlantılar bölümünde takipçi ve takip edilenler verisini iste, biçimi **JSON** ve tarih aralığını **Tüm zamanlar** olarak seç.
2. Panelde Instagram ZIP dosyasını veya `pending_follow_requests.json` ve `following.json` dosyalarını seç. Takip edilenler birden çok JSON parçasına bölündüyse `following_1.json`, `following_2.json` ve varsa devamını birlikte seç. Dışa aktarımın tüm zamanları kapsadığını ve seçtiğin listelerin bütün parçalarının aynı arşivden geldiğini doğrula. Oluşturulma bilgisi bulunamadığında dışa aktarımın tarihini gir. Saat alanı boş kaldığında seçtiğin günün İstanbul saatiyle başlangıcı kullanılır.
3. ZIP tarayıcıda işlenir. Sunucuya analiz için gereken kullanıcı adları, varsa kaynak tarihleri ve liste bütünlüğü bilgileri küçük gruplar hâlinde iletilir. Bulunmayan liste eksik olarak işaretlenir. Geçerli, boş bir liste sıfır kayıt olarak saklanır.
4. Yalnızca tamamlanmış yüklemeler analize girer. Aynı tarih ve takip verileriyle yeniden yüklenen arşiv sayaçları değiştirmez. Sonradan yüklenen eski arşivler, arşiv tarihlerine göre geçmişe yerleştirilir.

Bir otomasyon arşiv tarihini biliyorsa ZIP köküne veya seçilecek JSON dosyalarının yanına `archive_metadata.json` ekleyebilir. Uygulamanın tarih alanı `{"archive_created_at":"2026-02-01T12:00:00+03:00"}` biçiminde, saat dilimi belirtilmiş bir zaman bekler. Bu isteğe bağlı dosya uygulamanın içe aktarma biçimidir.

**Bekleyen** sayacı, son geçerli bekleyen listesine dayanır. **Kabul edildiği gözlenen** ve **Sonucu belirsiz** sayaçları seçili dönemde bu değişimlerin gözlendiği hesapları sayar. Arama ve durum filtresi tablodaki kullanıcıları bulmaya yardımcı olur. Kullanıcı adına tıklayarak gözlemlerin tarihçesini görebilirsin. Tarihler `Europe/Istanbul` saat dilimindedir.

- **Bekliyor** — Hesap son geçerli bekleyen listesinde yer alır.
- **Kabul edildiği gözlendi** — Hesap önceki bir arşivde bekliyorken sonraki arşivde takip edilenler arasında görülür. Panel, son bekleme gözlemi ile takip gözlemi arasındaki zaman aralığını gösterir.
- **Sonucu belirsiz** — Önceki arşivde bekleyen hesap, daha sonraki bir arşivin eksiksiz bekleyen ve takip edilen listelerinin ikisinde de bulunmaz. İstek geri çekilmiş veya reddedilmiş olabilir.
- **Veri yetersiz** — Karşılaştırma için gereken liste eksiktir. Son doğrulanmış durum ve tarihi görüntülenmeye devam eder.

Panel, ilk arşivde zaten takip edilen hesaplar için kabul olayı oluşturmaz. İstek gönderim tarihi yalnızca bekleyen istek kaydında kaynak tarihi varsa gösterilir. Arşivler arasında gönderilip yine o aralıkta sonuçlanan bir istek, bekleyen olarak hiç gözlenmediyse panelde kabul olayı oluşmaz.

## GitHub'dan Vercel'e dağıtım

1. Proje dosyalarını GitHub depona gönder. Vercel'de **Add New → Project** ekranından depoyu içe aktar.
2. Framework olarak **Next.js** ve kök dizin olarak proje dizinini seç. Projenin Node.js sürümünü **24.x** olarak kullan.
3. **Environment Variables** alanında `NEXT_PUBLIC_SUPABASE_URL` ve `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` değerlerini **Production** için ekle. Önizleme dağıtımlarında aynı hizmete bağlanmayı istiyorsan ilgili ortamı da seç.
4. **Deploy**'a tıkla. Yayın adresi açıldığında tek kullanıcı hesabınla giriş yap. İlk arşiv yüklemesini tamamladıktan sonra sayfayı yenileyerek kalıcı kaydı kontrol et. [Vercel GitHub entegrasyonu](https://vercel.com/docs/git/vercel-for-github) · [Vercel ortam değişkenleri](https://vercel.com/docs/environment-variables)

## Doğrulama

```bash
npm test
npm run typecheck
npm run build
```

Migration uygulandıktan sonra `tests/db/archive-import.sql` dosyasını bir **test veritabanında** `postgres` rolüyle çalıştırabilirsin. Bu kontrol erişim kurallarını, yarım yüklemeleri ve arşiv tekrarlarını sınar. Örnek işlemler test sonunda geri alınır.

Panelde elle denemek için sırayla `fixtures/instagram/day-1/` ve `fixtures/instagram/day-2/` dizinlerindeki JSON dosyalarını yükle. İlk arşiv üç bekleyen istek içerir. İkinci arşivde isteklerden biri bekler, biri takip edilenler listesine geçer ve biri iki listede de bulunmaz. Beklenen sayaçlar sırasıyla **1 bekleyen**, **1 kabul edildiği gözlenen**, **1 sonucu belirsiz**. İkinci arşivi tekrar yüklediğinde değerler aynı kalır.
