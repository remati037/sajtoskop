# F3 — Hetzner server: kupovina i podešavanje

Prati `docs/F3-worker.md` §6. Ovo je pun redosled, od otvaranja naloga do
provere da worker radi. Radi se **jednom**, traje 45–60 minuta prvi put
(od čega je pola čekanje na verifikaciju naloga).

**Šta ovaj server radi:** vuče poslove iz `job_queue`, zove Google Places,
preuzima tuđe sajtove, upisuje rezultat u Supabase. **Ne prima nijedan zahtev
spolja** — nema web server, nema otvoren port osim SSH.

**Šta ovaj server čuva:** ništa. Ceo state je u Supabase-u. Ako server izgori,
napraviš nov za 15 minuta i ne gubiš ni jedan red podataka. Zato mu ne treba
backup ni volume.

> **Jedna ozbiljna stvar pre nego što počneš.** U `.env` na ovom serveru stoji
> `SUPABASE_SERVICE_ROLE_KEY` — ključ koji zaobilazi ceo RLS. Ko dobije shell na
> ovoj mašini, dobio je celu bazu. Zato koraci 5 i 6 nisu opcioni.

---

## 0. Pre nego što otvoriš Hetzner

Napravi SSH ključ **na svom laptopu**, pre kreiranja servera. Ključ se dodaje
pri kreiranju, pa server nikad ne postoji sa lozinkom.

```bash
ls ~/.ssh/id_ed25519.pub          # ako već postoji, preskoči sledeću komandu
ssh-keygen -t ed25519 -C "marko@sajtoskop" -f ~/.ssh/id_ed25519
```

Passphrase **stavi** — ključ bez nje je isto što i lozinka u fajlu. macOS ga
pamti u Keychainu, pa je kucaš jednom:

```bash
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
```

Iskopiraj javni deo, treba ti u koraku 3:

```bash
pbcopy < ~/.ssh/id_ed25519.pub
```

---

## 1. Nalog

1. [console.hetzner.com](https://console.hetzner.com) → **Sign up**
2. Potvrdi mejl
3. Popuni podatke za naplatu

**Verifikacija.** Hetzner novim nalozima iz Srbije po pravilu traži potvrdu
identiteta — obično fotografiju lične karte ili pasoša, ponekad i pretplatu od
1 EUR na karticu. **Ume da traje od par sati do jednog radnog dana.** Uradi ovaj
korak uveče pre nego što planiraš da postavljaš server, da ne čekaš.

**Plaćanje.** Kartica ili PayPal. Naplata je unazad, prvog u mesecu, po satu
korišćenja. Za kupce van EU Hetzner obično ne obračunava nemački PDV — videćeš
tačan iznos na kasi, ne oslanjaj se na ovu rečenicu.

---

## 2. Projekat

**New project** → ime `sajtoskop`.

Projekat je granica pristupa i naplate. Kad kasnije dodaš staging server ili
Hetzner API token, sve stoji odvojeno od ostatka naloga.

---

## 3. SSH ključ u projekat

**Security → SSH keys → Add SSH key** → nalepi ono iz `pbcopy` → ime `laptop`.

Dodaj ga **sada**, pre servera. Ako ga dodaš posle, Hetzner šalje root lozinku
na mejl i tih par minuta server stoji sa lozinkom na javnoj IP adresi.

---

## 4. Server

**Servers → Add server:**

| Polje | Vrednost | Zašto |
|---|---|---|
| Location | **Falkenstein** ili **Nürnberg** | ~35ms do Beograda, isti kontinent kao Supabase EU |
| Image | **Ubuntu 24.04** | LTS do 2029, Docker paket radi bez podešavanja |
| Type | vidi tabelu ispod | |
| Networking | **IPv4 + IPv6** | ostavi oba |
| SSH keys | `laptop` | čekiraj — bez ovoga stiže lozinka na mejl |
| Volumes / Backups / Placement | **ništa** | server nema state, backup nema šta da čuva |
| Firewall | preskoči zasad | pravimo ga u koraku 5 |
| Name | `sajtoskop-worker` | pojavljuje se u shell promptu |

### Koji tip servera

Hetzner deli ponudu na tri grupe. Redosled po tome šta uzeti:

| Grupa | Linija | Za nas |
|---|---|---|
| **Cost-Optimized** | CX (x86), CAX (Arm64) | ✅ **prvi izbor ako ima zaliha** — najjeftinije |
| **Regular Performance** | CPX (x86 AMD) | ✅ rezervni izbor, novija generacija, skuplje |
| **General Purpose** | CCX (dedicated vCPU) | ❌ preskupo za ovaj posao |

**„Limited availability" na Cost-Optimized nije upozorenje nego stanje zaliha.**
To je starija generacija hardvera i u EU lokacijama ume da bude potpuno
rasprodata — tada su svi tipovi u toj grupi sivi i CX22 se prosto ne može
kupiti. Klikni kroz Falkenstein, Nürnberg i Helsinki; ako nigde nema, idi na
Regular Performance i ne gubi vreme čekajući.

**Od arhitektura izbegavaj samo Arm64.** Intel ili AMD nam je svejedno; bitno je
x86, jer u **F5 stiže Playwright sa Chromiumom**, a na ARM-u je dostupnost
binarnih verzija lutrija.

### Koliko vCPU-a stvarno treba

**Za F3 i F4 je dovoljna varijanta sa 1 vCPU i 2GB RAM-a** (CPX12 ili CX12).
Worker je gotovo isključivo I/O: čeka Places, čeka tuđe sajtove uz obavezan
razmak od 1s po domenu, čeka Supabase. Jedini pravi CPU posao je Ugly Score —
regex nad najviše 2MB HTML-a, dakle milisekunde. `WORKER_CONCURRENCY=3` na
jednom jezgru radi bez problema jer sva tri radnika najveći deo vremena spavaju
nad mrežom. `mem_limit: 1g` iz compose-a staje u 2GB sa viškom, a slika bez
Playwrighta je ispod 500MB.

**U F5 to postaje tesno**, jer Chromium traži 500MB–1GB po instanci. Tada:
`Rescale` na 2 vCPU / 4GB, ili ostaviš mašinu i ograničiš screenshot na jedan u
trenutku.

> Nadogradnja tipa je par klikova i minut nedostupnosti, i **reverzibilna je
> dokle god ne diraš disk** — nadogradnja diska jeste jednosmerna, CPU i RAM
> nisu. Server nema nikakav state, pa nema razloga danas plaćati hardver koji
> treba tek za dve faze.

**Cena, orijentaciono:** od ~5 EUR (Cost-Optimized, kad ima) do ~12 EUR
(Regular Performance, 1 vCPU) mesečno sa IPv4. Aktuelnu vidiš na samoj strani za
kreiranje — proveri je, jer se menja.

Klikni **Create & Buy now**. Server je gotov za ~20 sekundi. **Zapiši IPv4
adresu** — u nastavku je pišem kao `<IP>`.

---

## 5. Hetzner Cloud Firewall — prvi sloj

Ovo je firewall **ispred** mašine, na Hetznerovoj mreži. Radi i kad je server
ugašen, i kad se `ufw` slučajno isključi.

**Firewalls → Create Firewall** → ime `worker-samo-ssh`:

**Inbound rules** — samo jedno pravilo:

| Protocol | Port | Source |
|---|---|---|
| TCP | 22 | `0.0.0.0/0`, `::/0` |

Ako ti je kućna IP adresa fiksna, stavi `<tvoja-ip>/32` umesto `0.0.0.0/0` i
dobio si ozbiljno bolju zaštitu. Proveri adresu sa `curl -4 ifconfig.me`.
Na dinamičkoj adresi nemoj — zaključaćeš sebe napolju.

**Outbound rules** — ostavi kako Hetzner podrazumeva (sve dozvoljeno). Workeru
treba izlaz ka Supabase-u, Googleu i stotinama tuđih sajtova.

**Apply to** → izaberi `sajtoskop-worker`.

---

## 6. Prvo prijavljivanje i učvršćivanje

### 6.0 Gde je IP adresa i šta očekivati

Console → projekat `sajtoskop` → **Servers** → `sajtoskop-worker`. Adresa piše u
listi i na detaljnoj strani pod **Public Net → IPv4**, u obliku `116.203.45.187`.
Uzmi IPv4, ne IPv6.

U celom dokumentu `<IP>` znači tu adresu. **Uglaste zagrade se ne kucaju.**

```bash
ssh root@116.203.45.187        # primer, ne kopiraj doslovno
```

Prvi put SSH pita za otisak ključa (`Are you sure you want to continue
connecting?`) — ukucaj `yes`, celu reč. Ako traži passphrase, to je lozinka
tvog ključa sa laptopa, ne lozinka servera. Uspeh izgleda kao
`root@sajtoskop-worker:~#`.

| Greška | Šta znači |
|---|---|
| `Connection refused` | server se još diže, sačekaj minut |
| `Permission denied (publickey)` | SSH ključ nije zakačen pri kreiranju; root lozinka ti je stigla na mejl, uđi njome pa hitno odradi 6.2 i 6.3 |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | već si imao server na toj adresi → `ssh-keygen -R <IP>` |

> **Skrati sebi život.** Posle koraka 6.3 dodaj na laptopu u `~/.ssh/config`:
> ```
> Host sajtoskop
>   HostName <IP>
>   User marko
> ```
> Od tada je `ssh sajtoskop` i `scp .env sajtoskop:~/sajtoskop/.env`.

### 6.1 Ažuriraj sistem

```bash
apt update && apt upgrade -y
```

### 6.2 Korisnik bez root prava

```bash
adduser --disabled-password --gecos "" marko
usermod -aG sudo marko
rsync --archive --chown=marko:marko ~/.ssh /home/marko
```

`--disabled-password` znači da nalog nema lozinku uopšte — ulazi se samo
ključem. `sudo` će tražiti lozinku koje nema, pa je podesi:

```bash
passwd marko
```

### 6.3 Isključi lozinku i root prijavu

```bash
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/'                /etc/ssh/sshd_config
sed -i 's/^#\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config

# Ubuntu 24.04 drži override fajlove koji umeju da vrate lozinku nazad.
# Bez ovoga gornje tri linije ne znače ništa.
grep -rl "PasswordAuthentication yes" /etc/ssh/sshd_config.d/ 2>/dev/null \
  | xargs -r sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/'

sshd -t && systemctl restart ssh
```

> **NE ZATVARAJ OVU SESIJU.** Otvori **drugi terminal** i proveri:
> ```bash
> ssh marko@<IP>
> ```
> Tek kad to prođe, smeš da zatvoriš root sesiju. Ako se pokvarilo, prvi
> terminal ti je jedini put nazad. (A ako i njega izgubiš: Hetzner konzola →
> server → **Console**, to je VNC i radi bez SSH-a.)

### 6.4 ufw — drugi sloj

Hetznerov firewall već stoji ispred. Ovaj je za slučaj da neko ikad izmeni
pravila u konzoli, ili da se sutra pojavi kontejner koji sluša port.

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable
ufw status verbose
```

Očekivan ispis: `22/tcp ALLOW IN Anywhere` i **ništa drugo**.

### 6.5 Automatske bezbednosne zakrpe

```bash
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades     # izaberi Yes
```

Server koji niko ne gleda mesecima mora sam da se krpi.

### 6.6 fail2ban — preskoči

Sa isključenom lozinkom i portom 22 zatvorenim na Hetznerovom firewallu, brute
force nema šta da radi. `fail2ban` ovde dodaje složenost bez dobitka. Ako si
u koraku 5 ograničio SSH na svoju IP adresu, tim pre.

---

## 7. Docker

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker marko
systemctl enable --now docker
docker --version
```

Odjavi se i prijavi ponovo kao `marko` da grupa `docker` proradi:

```bash
exit
ssh marko@<IP>
docker ps        # mora da radi bez sudo
```

---

## 8. Google API ključ — najveći bezbednosni ROI u projektu

Ovo traje jedan minut i vredi više od svega iznad zajedno: ključ ukraden iz
repoa, loga ili Docker sloja posle ovoga **ne vredi ništa**.

**Google Cloud Console → APIs & Services → Credentials → ključ za Sajtoskop:**

1. **Application restrictions → IP addresses**
   → dodaj `<IP>` Hetzner servera
   → dodaj i svoju kućnu IP adresu ako pokrećeš `pnpm scan` sa laptopa
2. **API restrictions → Restrict key** → čekiraj **samo**:
   - Places API (New)
   - PageSpeed Insights API *(treba tek u F6, dodaj sad da se ne vraćaš)*
3. **APIs & Services → Places API (New) → Quotas** → dnevni limit **100
   requests/day**

Treći korak je poslednja mreža ispod `GLOBAL_DAILY_API_CAP = 75` iz
`packages/shared/src/plans.ts`: ako aplikativni brojač ikad otkaže, Google
odbija pozive umesto da ih naplati.

> Posle ovoga `pnpm scan` sa laptopa vraća `403 restrikcija ključa` sve dok ne
> dodaš i svoju IP adresu. To nije bug, to je poenta.

---

## 9. Kod na server

### 9.1 Deploy ključ za privatan repo

`git clone` privatnog repoa preko HTTPS-a traži token pri svakom `git pull`.
Deploy ključ je čistiji i **read-only**:

```bash
# na serveru, kao marko
ssh-keygen -t ed25519 -C "sajtoskop-worker deploy" -f ~/.ssh/deploy -N ""
cat ~/.ssh/deploy.pub
```

GitHub → repo → **Settings → Deploy keys → Add deploy key** → nalepi →
**NE čekiraj** „Allow write access".

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

ssh -T git@github.com     # očekivano: "Hi <repo>! You've successfully authenticated"
```

### 9.2 Kloniraj

```bash
cd ~
git clone git@github.com:<tvoj-nalog>/sajtoskop.git
cd sajtoskop
```

### 9.3 `.env`

`.env` je u `.gitignore` i **ne klonira se**. Prenesi ga sa laptopa:

```bash
# sa laptopa, iz korena repoa
scp .env marko@<IP>:~/sajtoskop/.env
```

```bash
# na serveru
chmod 600 ~/sajtoskop/.env
grep -c . ~/sajtoskop/.env     # samo da vidiš da je stigao
```

Moraju da postoje:

```
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_MAPS_API_KEY=...
WORKER_CONCURRENCY=3
```

Clerk promenljive workeru ne trebaju, ali ne smetaju.

---

## 10. Pokretanje

```bash
cd ~/sajtoskop
docker compose -f apps/worker/docker-compose.yml up -d --build
docker compose -f apps/worker/docker-compose.yml logs -f
```

Prvi build traje 2–4 minuta. Očekivan prvi red loga:

```
2026-08-09 12:00:00  worker start · 3 radnika · žetva na 15 min
```

Ako vidiš `UPOZORENJE: GOOGLE_MAPS_API_KEY nije postavljen` — `.env` nije
pročitan, proveri putanju u `env_file`.

Izađi iz loga sa `Ctrl+C` (kontejner ostaje da radi).

---

## 11. Provera da je sve na svom mestu

| Provera | Komanda | Očekivano |
|---|---|---|
| Samo SSH otvoren | `nmap -Pn -p- <IP>` sa laptopa | samo `22/tcp open` |
| Lozinka isključena | `ssh -o PubkeyAuthentication=no marko@<IP>` | `Permission denied (publickey)` |
| Root ne može | `ssh root@<IP>` | odbijeno |
| Worker radi | `docker compose -f apps/worker/docker-compose.yml ps` | `Up`, bez restart petlje |
| Preživljava restart | `sudo reboot`, sačekaj minut, pa `docker ps` | kontejner se sam podigao |
| Ubijanje usred posla | `docker kill <id>`, pa gledaj log 15 min | `žetva: 1 vraćeno u red` |
| Posao stvarno prolazi | pretraži novu kombinaciju u aplikaciji | lista se popuni za <2 min |
| Google vidi samo server | Cloud Console → Metrics → grupiši po Credential | pozivi samo sa `<IP>` |
| Ključ je zaključan | `pnpm scan` sa laptopa bez dodate IP adrese | `403 restrikcija ključa` |

`nmap` nemaš? `brew install nmap`. Bez njega, gruba provera:

```bash
nc -zv -w 3 <IP> 22 80 443    # samo 22 sme da uspe
```

---

## 12. Svakodnevni rad

**Deploy posle izmene:**

```bash
ssh marko@<IP>
cd ~/sajtoskop && git pull
docker compose -f apps/worker/docker-compose.yml up -d --build
```

Gašenje je uredno: Docker šalje `SIGTERM`, worker završi tekuće poslove i ne
uzima nove. Bez CI-a za sada (PRD §6).

**Log:**

```bash
docker compose -f apps/worker/docker-compose.yml logs -f --tail=100
docker compose -f apps/worker/docker-compose.yml logs --since 1h | grep PAO
```

Rotacija je u `docker-compose.yml` — `max-size: 10m`, `max-file: 5`, dakle
najviše 50MB. Bez toga `json-file` drajver puni disk dok ne pukne.

**Zdravlje mašine:**

```bash
df -h /                 # disk
free -m                 # memorija, kontejner je ograničen na 1GB
docker stats --no-stream
```

**Šta ako se worker vrti u restart petlji:**

```bash
docker compose -f apps/worker/docker-compose.yml logs --tail=50
```

Najčešća tri uzroka: `.env` nije pročitan, migracija 0002/0003 nije puštena
(`consume_api_call does not exist`), ili je `SUPABASE_SERVICE_ROLE_KEY` iz
pogrešnog projekta.

---

## 13. Trošak i šta može da ga poveća

| Stavka | Mesečno |
|---|---|
| Server + IPv4 | ~5 EUR (Cost-Optimized) do ~12 EUR (CPX12) |
| Saobraćaj | 20TB uključeno — worker koristi jedva par GB |
| Backup | isključen, i ne treba (state je u Supabase-u) |
| Snapshot | ne pravi ga; server je zamenljiv, ne dragocen |

**Postavi Hetzner budžet alarm:** Console → **Billing → Budget alerts** → 10 EUR.
Ne zato što će CX22 preskočiti taj iznos, nego zato što alarm stigne ako slučajno
ostaviš uključen drugi server ili volume.

---

## 14. Dve stvari koje ljudi zaborave

**Abuse prijave.** Worker obilazi stotine tuđih sajtova sa jedne IP adrese. Ako
se neko požali, prijava ide **Hetzneru**, a Hetzner traži odgovor u roku od 24h
— i ume da suspenduje server ako ga ne dobije. Zato u
`apps/worker/src/lib/robots.ts` postoji poštovanje `robots.txt` i razmak od
1 zahteva/s po domenu, a User-Agent nosi `Sajtoskop/1.0 (+https://sajtoskop.com/bot)`.
**Ne diraj to i ne podižij `WORKER_CONCURRENCY` iznad 3.** Drži mejl iz Hetzner
naloga pod nadzorom.

**Server je zamenljiv, ključ nije.** Ako ikad posumnjaš da je mašina
kompromitovana: rotiraj `SUPABASE_SERVICE_ROLE_KEY` u Supabase konzoli i
`GOOGLE_MAPS_API_KEY` u Google konzoli **pre** nego što ugasiš server. Sam
server obrišeš i napraviš nov za 15 minuta po ovom dokumentu — ništa se ne
gubi, jer worker ništa i ne čuva.
