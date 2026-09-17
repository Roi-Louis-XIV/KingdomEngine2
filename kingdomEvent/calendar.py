"""Calendrier fantasy projeté sur la timeline canonique de WorldClock."""
from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import Any

DEFAULT_CALENDAR={
    "name":"Calendrier du Royaume","start_year":1,"start_month_key":"month_01","start_day":1,
    "weekdays":["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"],
    "months":[{"key":f"month_{i:02d}","name":name,"days":days} for i,(name,days) in enumerate([
        ("Janvier",31),("Février",28),("Mars",31),("Avril",30),("Mai",31),("Juin",30),
        ("Juillet",31),("Août",31),("Septembre",30),("Octobre",31),("Novembre",30),("Décembre",31)],1)],
    "seasons":[
        {"key":"spring","name":"Printemps","emoji":"🌱","start_month_key":"month_03","start_day":1},
        {"key":"summer","name":"Été","emoji":"☀️","start_month_key":"month_06","start_day":1},
        {"key":"autumn","name":"Automne","emoji":"🍂","start_month_key":"month_09","start_day":1},
        {"key":"winter","name":"Hiver","emoji":"❄️","start_month_key":"month_12","start_day":1},
    ],
}

@dataclass(frozen=True,slots=True)
class WorldDate:
    year:int; month_key:str; month_name:str; month_index:int; day:int; weekday:str; weekday_index:int; hour:int; minute:int; absolute_day:int
    def dict(self): return asdict(self)

class CalendarError(ValueError): pass

class CalendarEngine:
    def __init__(self, definition:dict[str,Any]|None=None):
        self.definition={**DEFAULT_CALENDAR,**(definition or {})}; self.months=list(self.definition.get("months") or []); self.weekdays=list(self.definition.get("weekdays") or [])
        if not self.months or any(int(m.get("days",0))<1 for m in self.months): raise CalendarError("Le calendrier doit contenir des mois valides.")
        if not self.weekdays: raise CalendarError("Le calendrier doit contenir au moins un jour de semaine.")
        keys=[m.get("key") for m in self.months]
        if len(keys)!=len(set(keys)): raise CalendarError("Les identifiants de mois doivent être uniques.")

    @property
    def days_per_year(self): return sum(int(m["days"]) for m in self.months)

    def from_world_hours(self,total_hours:float)->WorldDate:
        elapsed_day=max(0,int(total_hours//24)); hour=int(total_hours%24); minute=int((total_hours%1)*60)
        start_year=int(self.definition.get("start_year",1)); start_month=next((i for i,m in enumerate(self.months) if m["key"]==self.definition.get("start_month_key")),0); start_day=max(1,int(self.definition.get("start_day",1)))
        origin=sum(int(m["days"]) for m in self.months[:start_month])+start_day-1
        total=origin+elapsed_day; year=start_year+total//self.days_per_year; day_of_year=total%self.days_per_year
        cursor=0; month_index=0
        for index,month in enumerate(self.months):
            if day_of_year<cursor+int(month["days"]): month_index=index; break
            cursor+=int(month["days"])
        month=self.months[month_index]; day=day_of_year-cursor+1; weekday_index=elapsed_day%len(self.weekdays)
        return WorldDate(year,str(month["key"]),str(month["name"]),month_index,day,str(self.weekdays[weekday_index]),weekday_index,hour,minute,elapsed_day+1)

    def to_world_hours(self,year:int,month_key:str,day:int,hour:int=0,minute:int=0)->float:
        index=next((i for i,m in enumerate(self.months) if m["key"]==month_key),None)
        if index is None: raise CalendarError("Mois inconnu.")
        maximum=int(self.months[index]["days"])
        if not 1<=int(day)<=maximum or not 0<=int(hour)<=23 or not 0<=int(minute)<=59: raise CalendarError("Date monde invalide.")
        start_index=next((i for i,m in enumerate(self.months) if m["key"]==self.definition.get("start_month_key")),0)
        origin=sum(int(m["days"]) for m in self.months[:start_index])+int(self.definition.get("start_day",1))-1
        target=(int(year)-int(self.definition.get("start_year",1)))*self.days_per_year+sum(int(m["days"]) for m in self.months[:index])+int(day)-1
        return (target-origin)*24+int(hour)+int(minute)/60

    def season(self,date:WorldDate)->dict[str,Any]|None:
        seasons=list(self.definition.get("seasons") or [])
        if not seasons:return None
        starts=[]
        for item in seasons:
            try: offset=self.to_world_hours(date.year,str(item["start_month_key"]),int(item.get("start_day",1)))//24
            except CalendarError: continue
            starts.append((int(offset)%self.days_per_year,item))
        if not starts:return None
        current=(sum(int(m["days"]) for m in self.months[:date.month_index])+date.day-1)%self.days_per_year
        starts.sort(key=lambda row:row[0]); chosen=max((row for row in starts if row[0]<=current),default=starts[-1],key=lambda row:row[0]); next_start=next((row[0] for row in starts if row[0]>chosen[0]),starts[0][0]+self.days_per_year)
        elapsed=(current-chosen[0])%self.days_per_year
        return {**chosen[1],"day":elapsed+1,"duration_days":next_start-chosen[0]}

    def month_days(self,year:int,month_key:str)->list[WorldDate]:
        month=next((m for m in self.months if m["key"]==month_key),None)
        if not month: raise CalendarError("Mois inconnu.")
        return [self.from_world_hours(self.to_world_hours(year,month_key,day)) for day in range(1,int(month["days"])+1)]
