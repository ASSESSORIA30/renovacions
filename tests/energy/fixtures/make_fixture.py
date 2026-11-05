import sys, openpyxl, datetime
src, dst = sys.argv[1], sys.argv[2]
hdr = [c.value for c in next(openpyxl.load_workbook(src).active.iter_rows(max_row=1))]
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Page1"; ws.append(hdr)
def row(**kv):
    ws.append([kv.get(h) for h in hdr])
M = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"]
pot = [40,40,30,20,20,35,50,30,30,20,30,45]
ea = [10000]*12
er = [2000,2000,2000,2000,2000,2000,6000,2000,2000,2000,2000,2000]
base = {"Tipo Energía":"Electricidad","Provincia":"Barcelona","Localidad":"Sabadell","Tarifa":"3.0TD",
  "Pot. P1 (kW)":"60,5","Pot. P2 (kW)":60.5,"Pot. P3 (kW)":60.5,"Pot. P4 (kW)":60.5,"Pot. P5 (kW)":60.5,"Pot. P6 (kW)":60.5,
  "Tipo P.M.":"4","Ctrl Potencia":"Maxímetro","Pot. Máx. BIE (kW)":"1.200,0","E.A. Anual (kWh)":120000,"E.R. Anual (kVArh)":28000,
  "Pot. Anual (kW)":50,"F. Caducidad BIE":datetime.datetime(2026,1,15),"F. Últ. Lectura":"15/10/2026","Contratable":"SI","Informacion Impagos":"NO"}
for i,m in enumerate(M):
    base[f"Pot. {m} (kW)"]=pot[i]; base[f"E.A. {m} (kWh)"]=ea[i]; base[f"E.R. {m} (kVArh)"]=er[i]
row(CUPS="ES0021000000000001RK0F", **{k:v for k,v in base.items()})
row(CUPS="ES 0021 0000 0000 0001 RK 0F", **{**base, "Comercializadora":"DUPLICADO"})
row(CUPS="ES0021000000000002XX", Tarifa="2.0TD", **{"Pot. P1 (kW)":4.6,"Pot. P2 (kW)":4.6,"Contratable":"NO","Motivo NO Contratable":"Baja"})
row()
row(Tarifa="3.0TD")
wb.save(dst)
