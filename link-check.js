//基準になるサイトマップ httpから始まると動的に取得
//そうでない場合はローカルファイルから取得
const strSitemapRoot = 'https://nanbu.marune205.net/sitemap.xml';
//const strSitemapRoot = 'd:\\link\\sitemap1.xml';

//結果保存先 通常は上書き
const outputFile ='d:\\link\\result.csv';

//読み飛ばし設定
//ここで入力したアドレスが出現するまで読み飛ばす
//途中で停止した場合などに使う
//値が空欄でない場合は結果ファイルの出力は追記モード
const strSkipToUrl='';

//XMLHttpRequestを使う場合に有効にしてください。
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

//動的にサイトマップ取得する際か、チェックにaxiosを利用する場合に有効にしてください
const axios = require('axios');

//ファイルライブラリ
const fs = require('fs');
//文字コード変換ライブラリ
const iconv = require('iconv-lite');
//xmlパーサライブラリ
const htmlparser2 = require("htmlparser2");;
//ヘッドレスブラウザライブラリ
const puppeteer = require('puppeteer');

//一度チェックしたページを記憶して通信を削減
let resultMap = new Map(); 

//ヘッドレスブラウザ
let browser;
let page;

//サイトマップインデックスを含む場合の用のパーサの設定

//ローカルファイルのXMLサイトマップ用のパーサの設定
const parserForNormalSitemap = new htmlparser2.Parser({
    onopentag(name, attributes) {
        //ターゲットとなるタグの出現を保持するフラグ
        parserForNormalSitemap.blnTarget=false;
        switch(name) {
        case "loc":
            //フラグをONに
            parserForNormalSitemap.blnTarget=true;
            break;
        }
    },
    ontext(text) {
        //タグ内のテキストではターゲットのタグの時のみ処理
        if (parserForNormalSitemap.blnTarget) {
        //オブジェクト内部に結果を保持する設定
            if (parserForNormalSitemap.hasOwnProperty('results')===false) {
                parserForNormalSitemap.results = [];
            }
            parserForNormalSitemap.results.push(text);
        }
    },
    onclosetag(tagname) {
        //閉じタグではなにもしない。
    },
});

async function getUrls(strFilePathOrUrl) {
    let strUrls=[];
    if (strFilePathOrUrl.startsWith('http')) {
        //httpから始まっていたらWebから取得
        strUrls = await getUrlsFromWeb(strFilePathOrUrl);
    } else {
        strUrls = await getUrlsFromFile(strFilePathOrUrl);
    }

    return strUrls;
}

async function getUrlsFromWeb(strUrl) {
    //URLを取得してサイトマップインデックスだった場合は再帰
    console.log(strUrl);
    let results = await getSiteMapsFromWeb(strUrl);
    let strUrls =[];
    for (let i =0; i < results.length;i++) {         
        if (results[i].nest) {
            //再帰
            let concat = await getUrlsFromWeb(results[i].url);
            for (let j = 0; j < concat.length; j++) {
                strUrls.push(concat[j]);
            }
        } else {
            strUrls.push(results[i].url);
        }
    }
    return strUrls;   
}

async function getSiteMapsFromWeb(strUrl) {
    //サイトマップインデックスに対応
    //一旦前の結果をクリア(同期処理を想定)    
    //parserForBloggerSitemap.results =[];
    
    let parserForBloggerSitemap = new htmlparser2.Parser({
        onopentag(name, attributes) {
            //ターゲットとなるタグの出現を保持するフラグ
            parserForBloggerSitemap.blnTarget=false;
            switch(name) {
            case "loc":
                //フラグをON
                parserForBloggerSitemap.blnTarget=true;
                break;
            case "urlset":
                parserForBloggerSitemap.blnNest=false;
                break;
            case "sitemapindex":
                parserForBloggerSitemap.blnNest=true;
                break;
            default:
                
            }
        },
        ontext(text) {
            //タグ内のテキストではターゲットのタグの時のみ処理
            if (parserForBloggerSitemap.blnTarget) {
                //オブジェクト内部に結果を保持する設定
                if (parserForBloggerSitemap.hasOwnProperty('results')===false) {
                    parserForBloggerSitemap.results = [];
                }
                parserForBloggerSitemap.results.push({nest: parserForBloggerSitemap.blnNest, url: text});
            }
        },
        onclosetag(tagname) {
            //閉じタグではなにもしない。
        },
    });

    let r = await axios.get(strUrl).then(function (response) {
        parserForBloggerSitemap.write(response.data);
        parserForBloggerSitemap.end();
        console.log(parserForBloggerSitemap.results);
        return parserForBloggerSitemap.results; 
    }).catch(function(error) {
        console.log(error);
        return [];
    });

    return r;
}

async function getUrlsFromFile(strPath) {
    //ローカルのXMLサイトマップファイルからURLを取得
    try {
        //一旦前の結果をクリア(同期処理を想定)
        parserForNormalSitemap.results =[];
        
        parserForNormalSitemap.write(fs.readFileSync(strPath, "utf8"));
        parserForNormalSitemap.end();
        
        return parserForNormalSitemap.results; 
    } catch (error) {
        console.log(error);
        return [];
    }
}

//ページのアドレスからリンクを取得する
async function getLinks(strTargetUrl){

    console.log(strTargetUrl);
    let result=false;
  
    try {
      await page.goto(strTargetUrl, {waitUntil: 'networkidle2'});
  
      //ヘッドレスブラウザの中でJSを使う。この中のコードは本体のコードとは別物
      result = await page.evaluate(function() {
        
        //aタグのリストを取得
        let ret = [];
        try {
            let as = document.getElementsByTagName('a');
            for (let i = 0; i < as.length; i++) {
                //herf=javascript:等は対象にしない
                if (as[i].href.startsWith("http")) {
                    //アドセンスだったら対象外に
                    if(as[i].href.indexOf("www.googleadservices.com") < 0) {
                        ret.push([as[i].href,as[i].innerHTML]);
                    }
                }
            }
        } catch(e) {
            return false;
        }
        return ret;
      });
  
    
    } catch(e) {
       //donothing
       return false;
    }
  
    return result;
}

async function checkLinkPageXMLHttpRequest(strLinkUrl) {
    //リダイレクト時は300系の結果を返す

    if (resultMap.has(strLinkUrl)) {
        return resultMap.get(strLinkUrl);
    }

    let res = await new Promise((resolve,reject)=> {
        let req = new XMLHttpRequest();
        let result;

        let timeout=setTimeout(()=> {reject('timeout')},1000 * 60);
        req.onreadystatechange=function(){
            
            clearInterval(timeout);

            if (req.readyState == 4) {
                //console.log(req);
                resultMap.set(strLinkUrl,req.status);
                resolve(req.status);
            }
        }

        //falseを指定して結果を待つ
        req.open('GET',strLinkUrl,false);
        req.send(null);
    });

    return res;
}


async function checkLinkPagePuppeteer(strTargetUrl){
    //puppeteerはファイルダウンロードのチェックも可能
    //JSによるリダイレクトも追う

    if(resultMap.has(strTargetUrl)) {
        return resultMap.get(strTargetUrl);
    }
    try {
        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.85 Safari/537.36");
            
        await page._client.send('Page.setDownloadBehavior', {
            behavior: 'deny',
            downloadPath: 'c:\\temp'
        });
           
        let strErrMsg ="";
        let r = await page.goto(strTargetUrl, {waitUntil: 'domcontentloaded'}).catch(function(e) {
            if (0 <= String(e).indexOf('Error: net::ERR_ABORTED')) {
                 strErrMsg = "abort";
            } else {
                 strErrMsg = String(e);
            }
        });
      
        let strStatus = strErrMsg === "" ?  String(r.status()) : strErrMsg; 
        
        resultMap.set(strTargetUrl,strStatus)
        return strStatus;

    } catch(e) {
       //donothing
       resultMap.set(strTargetUrl,String(e))
       return String(e);
    }
}

async function checkLinkPageAxios(strTargetUrl){
    //AXIOSは通常のリダイレクトを追う
    if(resultMap.has(strTargetUrl)) {
        return resultMap.get(strTargetUrl);
    }
    try {
        let r = await axios.get(strTargetUrl).then(function (response) {
            return response.status; 
        }).catch(function(error) {
            //console.log(error);
            return String(error);
        });
    
        return r;
    } catch(e) {
       //donothing
       resultMap.set(strTargetUrl,String(e))
       return String(e);
    }
}

function isInnerLink(strPageUrl, strLinkUrl) {
    //#で指定するページ内部移動のためのリンクはチェックしない
    if (strLinkUrl.startsWith(strPageUrl)) {
        return true;
    } else {
        return false;
    }
}

function sanitizeAndConv(str) {
    //csvファイルの作成に邪魔になる文字を除去
    //またエクセルで開いた時に文字化けしないようにiconvでSJISに
    return iconv.encode(str.replace(/(\r|\n|,)/g,''),'Windows932');
}
 
async function sleep(intMs) {
    //スリープ
    return new Promise(function(resolution){ setTimeout(resolution, intMs) });
}

//メイン処理
async function main() {
  
    let strBlogUrls = await getUrls(strSitemapRoot);
    let blnSkip = false;
    let intFd=0;
    //指定のURLまで読み飛ばし
    if (strSkipToUrl!=="") {
        blnSkip = true;
        intFd = fs.openSync(outputFile,'a');
    } else {
        intFd = fs.openSync(outputFile,'w');
    }

    //ヘッドレスブラウザ起動
    browser = await puppeteer.launch();
    page = await browser.newPage();

    for (let i =0; i < strBlogUrls.length; i++) {  
      if (blnSkip) {
          if (strSkipToUrl===strBlogUrls[i]) {
            blnSkip = false;
          } else {
            continue;
          }
      }

      await sleep(5000);
      
      let links = await getLinks(strBlogUrls[i]);
      if (links === false) {
        //ページのリンク取得時に404,503等のエラーが出た場合
        fs.writeSync(intFd,sanitizeAndConv(strBlogUrls[i]));
        fs.writeSync(intFd,',');
        fs.writeSync(intFd,sanitizeAndConv('ページへアクセスできませんでした'));
        fs.writeSync(intFd,',');
        fs.writeSync(intFd,'');
        fs.writeSync(intFd,',');
        fs.writeSync(intFd,'NG\r\n');
      } else {
        for (let j = 0; j < links.length; j++) {
            if (isInnerLink(strBlogUrls[i],links[j][0])) {
                //#による内部移動リンクをスキップ
                fs.writeSync(intFd,sanitizeAndConv(strBlogUrls[i]));
                fs.writeSync(intFd,',');
                fs.writeSync(intFd,sanitizeAndConv(links[j][0]));
                fs.writeSync(intFd,',');
                fs.writeSync(intFd,sanitizeAndConv(links[j][1]));
                fs.writeSync(intFd,',');
                fs.writeSync(intFd,'InnerLink\r\n');    
            } else {
                //let strStatus = await checkLinkPageAxios(links[j][0]);
                //let strStatus = await checkLinkPagePuppeteer(links[j][0]);
                let strStatus = await checkLinkPageXMLHttpRequest(links[j][0]);

                fs.writeSync(intFd,sanitizeAndConv(strBlogUrls[i]));
                fs.writeSync(intFd,',');
                fs.writeSync(intFd,sanitizeAndConv(links[j][0]));
                fs.writeSync(intFd,',');
                fs.writeSync(intFd,sanitizeAndConv(links[j][1]));
                fs.writeSync(intFd,',');
                fs.writeSync(intFd,strStatus+'\r\n');        
            }
        }
      }
    }
    fs.closeSync(intFd);
  
    await browser.close();

    //終了(なにかプロセスが残って終了しないようならコメントアウトを外す)
    //process.exit(0);
}

//実行
main();